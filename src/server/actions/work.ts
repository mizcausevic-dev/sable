"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UserError, idleState, isRedirectError, runAction, type ActionState } from "@/lib/action";
import { publicDbError } from "@/lib/errors";
import { isNotificationKind } from "@/lib/notifications";
import { withUser } from "@/lib/db";
import { parseMajorToMinor, parseQuantityToMilli } from "@/lib/money";
import { can, inviteRolesFor } from "@/lib/permissions";
import { canTransitionCommercial, canTransitionInvoice } from "@/lib/states";
import { ORG_COOKIE } from "@/lib/tokens";
import { newSecretToken } from "@/lib/tokens";
import { todayInTimeZone } from "@/lib/time";
import { validateCustomFields, type FieldDefinition } from "@/lib/custom-fields";
import {
  budgetSchema,
  clientSchema,
  commentSchema,
  contactSchema,
  costRateSchema,
  dateRangeSchema,
  documentSchema,
  fieldDefinitionSchema,
  fieldError,
  invitationSchema,
  noteSchema,
  organizationSettingsSchema,
  paymentSchema,
  projectSchema,
  taskSchema,
  timeEntrySchema,
} from "@/lib/validation";
import { requireOrg, requireUser } from "../context";
import {
  addAssignee,
  addComment,
  addDependency,
  createCommercial,
  createProject,
  createTask,
  insertClient,
  insertContact,
  insertCostRate,
  insertFieldDefinition,
  insertNote,
  insertTime,
  issueInvoice,
  recordPayment,
  savePreference,
  setAvailability,
  setTaskStatus,
  transitionCommercial,
  updateClientFields,
  updateClientStage,
  upsertBudget,
  voidInvoice,
} from "../mutations";
import { asText } from "../sql";

function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

async function actor(permission: Parameters<typeof can>[1]) {
  const ctx = await requireOrg();
  if (!can(ctx.org.role, permission)) throw new UserError("You do not have access to do that.");
  return ctx;
}

export async function switchOrgAction(formData: FormData) {
  const ctx = await requireUser();
  const orgId = String(formData.get("organizationId") ?? "");
  const { listMemberships } = await import("../context");
  const memberships = await listMemberships(ctx.id);
  if (!memberships.some((membership) => membership.organizationId === orgId)) {
    throw new UserError("You do not have access to do that.");
  }
  const jar = await cookies();
  jar.set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/app");
}

export async function updateOrganizationAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = organizationSettingsSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  return runAction(async () => {
    const ctx = await actor("org.settings");
    await withUser(ctx.user.id, (db) =>
      db.query(`update organizations set name = $1, timezone = $2 where id = $3`, [
        parsed.data.name,
        parsed.data.timezone,
        ctx.org.organizationId,
      ]),
    );
    revalidatePath("/app/settings");
  });
}

export async function inviteAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = invitationSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  const issued = newSecretToken();
  const result = await runAction(async () => {
    const ctx = await actor("org.invite");
    if (!inviteRolesFor(ctx.org.role).includes(parsed.data.role)) throw new UserError("You cannot invite that role.");
    await withUser(ctx.user.id, (db) =>
      db.query(
        `insert into invitations (organization_id, email, role, token_hash, expires_at, invited_by)
         values ($1,$2,$3,$4, now() + interval '7 days', $5)`,
        [ctx.org.organizationId, parsed.data.email, parsed.data.role, issued.hash, ctx.user.id],
      ),
    );
  });
  if (!result.ok) return result;
  revalidatePath("/app/settings/members");
  return { ok: true, notice: `/invite/${issued.token}` };
}

async function memberChange(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    if (isRedirectError(error)) throw error;
    throw new UserError(error instanceof UserError ? error.message : publicDbError(error));
  }
}

export async function revokeInviteAction(formData: FormData) {
  await memberChange(async () => {
    const ctx = await actor("org.invite");
    await withUser(ctx.user.id, (db) =>
      db.query(`select private.revoke_invitation($1::uuid)`, [String(formData.get("invitationId"))]),
    );
    revalidatePath("/app/settings/members");
  });
}

export async function setRoleAction(formData: FormData) {
  await memberChange(async () => {
    const ctx = await actor("org.members");
    await withUser(ctx.user.id, (db) =>
      db.query(`select private.set_member_role($1::uuid, $2::uuid, $3)`, [
        ctx.org.organizationId,
        String(formData.get("userId")),
        String(formData.get("role")),
      ]),
    );
    revalidatePath("/app/settings/members");
  });
}

export async function removeMemberAction(formData: FormData) {
  await memberChange(async () => {
    const ctx = await actor("org.members");
    await withUser(ctx.user.id, (db) =>
      db.query(`select private.remove_member($1::uuid, $2::uuid)`, [ctx.org.organizationId, String(formData.get("userId"))]),
    );
    revalidatePath("/app/settings/members");
  });
}

export async function createClientAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    stage: formData.get("stage"),
    website: formData.get("website") ?? "",
  });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  return runAction(async () => {
    const ctx = await actor("clients.write");
    const definitions = await fieldDefs(ctx.user.id, ctx.org.organizationId);
    const values: Record<string, string> = {};
    for (const definition of definitions) {
      const raw = formData.get(`field.${definition.key}`);
      if (typeof raw === "string") values[definition.key] = raw;
    }
    const checkedFields = validateCustomFields(definitions, values);
    if (!checkedFields.ok) throw new UserError(checkedFields.error);
    const id = await withUser(ctx.user.id, (db) =>
      insertClient(db, {
        orgId: ctx.org.organizationId,
        actorId: ctx.user.id,
        name: parsed.data.name,
        stage: parsed.data.stage,
        website: parsed.data.website ?? "",
        customFields: checkedFields.value,
      }),
    );
    redirect(`/app/clients/${id}`);
  });
}

async function fieldDefs(userId: string, orgId: string): Promise<FieldDefinition[]> {
  const rows = await withUser(userId, (db) =>
    db.query(
      `select key, label, field_type, required, options, archived from client_field_definitions where organization_id = $1`,
      [orgId],
    ),
  );
  return rows.map((row) => ({
    key: asText(row.key),
    label: asText(row.label),
    fieldType: asText(row.field_type) as FieldDefinition["fieldType"],
    required: row.required === true,
    options: Array.isArray(row.options) ? row.options.map(String) : [],
    archived: row.archived === true,
  }));
}

export async function stageAction(formData: FormData) {
  const ctx = await actor("clients.write");
  const stage = String(formData.get("stage") ?? "");
  await withUser(ctx.user.id, (db) =>
    updateClientStage(db, {
      orgId: ctx.org.organizationId,
      actorId: ctx.user.id,
      clientId: String(formData.get("clientId")),
      stage,
    }),
  );
  revalidatePath("/app/clients");
}

export async function contactAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email") || undefined,
    phone: formData.get("phone") ?? "",
    title: formData.get("title") ?? "",
  });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  return runAction(async () => {
    const ctx = await actor("clients.write");
    await withUser(ctx.user.id, (db) =>
      insertContact(db, {
        orgId: ctx.org.organizationId,
        clientId: String(formData.get("clientId")),
        name: parsed.data.name,
        email: parsed.data.email ?? "",
        phone: parsed.data.phone ?? "",
        title: parsed.data.title ?? "",
      }),
    );
    revalidatePath("/app/clients");
  });
}

export async function noteAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = noteSchema.safeParse({ body: formData.get("body"), internal: checked(formData, "internal") });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  return runAction(async () => {
    const ctx = await actor("clients.write");
    await withUser(ctx.user.id, (db) =>
      insertNote(db, {
        orgId: ctx.org.organizationId,
        clientId: String(formData.get("clientId")),
        actorId: ctx.user.id,
        body: parsed.data.body,
        internal: parsed.data.internal,
      }),
    );
    revalidatePath("/app/clients");
  });
}

export async function fieldsAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = fieldDefinitionSchema.safeParse({
    key: formData.get("key"),
    label: formData.get("label"),
    fieldType: formData.get("fieldType"),
    required: checked(formData, "required"),
    options: String(formData.get("options") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  if (parsed.data.fieldType === "select" && parsed.data.options.length === 0) {
    return { ok: false, error: "Select fields need at least one option" };
  }
  return runAction(async () => {
    const ctx = await actor("clients.write");
    await withUser(ctx.user.id, (db) => insertFieldDefinition(db, { orgId: ctx.org.organizationId, ...parsed.data }));
    revalidatePath("/app/settings");
  });
}

export async function customFieldsAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await actor("clients.write");
    const definitions = await fieldDefs(ctx.user.id, ctx.org.organizationId);
    const values: Record<string, string> = {};
    for (const definition of definitions) {
      const raw = formData.get(`field.${definition.key}`);
      if (typeof raw === "string") values[definition.key] = raw;
    }
    const checkedFields = validateCustomFields(definitions, values);
    if (!checkedFields.ok) throw new UserError(checkedFields.error);
    await withUser(ctx.user.id, (db) =>
      updateClientFields(db, {
        orgId: ctx.org.organizationId,
        clientId: String(formData.get("clientId")),
        customFields: checkedFields.value,
      }),
    );
    revalidatePath("/app/clients");
  });
}

export async function grantClientAccessAction(formData: FormData) {
  const ctx = await actor("finance.write");
  const userId = String(formData.get("userId"));
  const clientId = String(formData.get("clientId"));
  const projectId = String(formData.get("projectId") ?? "");
  await withUser(ctx.user.id, async (db) => {
    await db.query(
      `insert into client_access (organization_id, client_id, user_id) values ($1,$2,$3) on conflict do nothing`,
      [ctx.org.organizationId, clientId, userId],
    );
    if (projectId) {
      await db.query(
        `insert into project_access (organization_id, project_id, user_id) values ($1,$2,$3) on conflict do nothing`,
        [ctx.org.organizationId, projectId, userId],
      );
    }
  });
  revalidatePath("/app/clients");
}

export async function createProjectAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = projectSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
    status: formData.get("status"),
    description: formData.get("description") ?? "",
    timezone: formData.get("timezone"),
    startOn: formData.get("startOn") ?? "",
    endOn: formData.get("endOn") ?? "",
    templateId: formData.get("templateId") ?? "",
  });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  return runAction(async () => {
    const ctx = await actor("projects.write");
    const id = await withUser(ctx.user.id, (db) =>
      createProject(db, {
        orgId: ctx.org.organizationId,
        actorId: ctx.user.id,
        clientId: parsed.data.clientId,
        name: parsed.data.name,
        status: parsed.data.status,
        description: parsed.data.description,
        timezone: parsed.data.timezone,
        startOn: parsed.data.startOn ?? "",
        endOn: parsed.data.endOn ?? "",
        templateId: parsed.data.templateId ?? "",
      }),
    );
    redirect(`/app/projects/${id}`);
  });
}

export async function createTaskAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = taskSchema.safeParse({
    title: formData.get("title"),
    detail: formData.get("detail") ?? "",
    status: formData.get("status"),
    clientVisible: checked(formData, "clientVisible"),
    dueOn: formData.get("dueOn") ?? "",
    parentTaskId: formData.get("parentTaskId") ?? "",
    milestoneId: formData.get("milestoneId") ?? "",
  });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  return runAction(async () => {
    const ctx = await actor("tasks.write");
    const id = await withUser(ctx.user.id, (db) =>
      createTask(db, {
        orgId: ctx.org.organizationId,
        actorId: ctx.user.id,
        projectId: String(formData.get("projectId")),
        title: parsed.data.title,
        detail: parsed.data.detail,
        status: parsed.data.status,
        clientVisible: parsed.data.clientVisible,
        dueOn: parsed.data.dueOn ?? "",
        parentTaskId: parsed.data.parentTaskId ?? "",
        milestoneId: parsed.data.milestoneId ?? "",
      }),
    );
    redirect(`/app/projects/${String(formData.get("projectId"))}/tasks/${id}`);
  });
}

export async function statusAction(formData: FormData) {
  const ctx = await actor("tasks.write");
  await withUser(ctx.user.id, (db) =>
    setTaskStatus(db, {
      orgId: ctx.org.organizationId,
      taskId: String(formData.get("taskId")),
      status: String(formData.get("status")),
    }),
  );
  revalidatePath("/app/projects");
}

export async function assignAction(formData: FormData) {
  const ctx = await requireOrg();
  const userId = String(formData.get("userId"));
  if (ctx.org.role === "contributor" && userId !== ctx.user.id) {
    throw new UserError("You do not have access to do that.");
  }
  if (!can(ctx.org.role, "tasks.write")) throw new UserError("You do not have access to do that.");
  if (ctx.org.role !== "contributor" && !can(ctx.org.role, "tasks.assign") && userId !== ctx.user.id) {
    throw new UserError("You do not have access to do that.");
  }
  const taskId = String(formData.get("taskId"));
  const projectId = String(formData.get("projectId"));
  await withUser(ctx.user.id, (db) =>
    addAssignee(db, {
      orgId: ctx.org.organizationId,
      taskId,
      userId,
      title: String(formData.get("title") ?? "Task"),
      href: `/app/projects/${projectId}/tasks/${taskId}`,
    }),
  );
  revalidatePath("/app/projects");
}

export async function dependencyAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await actor("tasks.write");
    await withUser(ctx.user.id, (db) =>
      addDependency(db, {
        orgId: ctx.org.organizationId,
        predecessorId: String(formData.get("predecessorId")),
        successorId: String(formData.get("successorId")),
      }),
    );
    revalidatePath("/app/projects");
  });
}

export async function commentAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const internal = can((await requireOrg()).org.role, "tasks.write") ? checked(formData, "internal") : false;
  const parsed = commentSchema.safeParse({ body: formData.get("body"), internal });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  return runAction(async () => {
    const ctx = await requireOrg();
    await withUser(ctx.user.id, (db) =>
      addComment(db, {
        orgId: ctx.org.organizationId,
        taskId: String(formData.get("taskId")),
        actorId: ctx.user.id,
        body: parsed.data.body,
        internal: ctx.org.role === "client" ? false : parsed.data.internal,
      }),
    );
    revalidatePath("/app/projects");
  });
}

function linesFrom(formData: FormData) {
  const descriptions = formData.getAll("description").map(String);
  const quantities = formData.getAll("quantity").map(String);
  const amounts = formData.getAll("unitAmount").map(String);
  return descriptions.map((description, index) => ({
    description,
    quantity: quantities[index] ?? "",
    unitAmount: amounts[index] ?? "",
  }));
}

export async function createDocumentAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const kind = String(formData.get("kind"));
  if (kind !== "estimate" && kind !== "proposal" && kind !== "invoice") return { ok: false, error: "Unknown document" };
  const parsed = documentSchema.safeParse({
    clientId: formData.get("clientId"),
    projectId: formData.get("projectId") ?? "",
    title: formData.get("title"),
    lines: linesFrom(formData),
  });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  return runAction(async () => {
    const ctx = await actor("finance.write");
    let lines;
    try {
      lines = parsed.data.lines.map((line) => ({
        description: line.description,
        quantityMilli: parseQuantityToMilli(line.quantity),
        unitMinor: parseMajorToMinor(line.unitAmount),
      }));
    } catch (error) {
      throw new UserError(error instanceof Error ? error.message : "Check the line items");
    }
    const created = await withUser(ctx.user.id, (db) =>
      createCommercial(db, kind, {
        orgId: ctx.org.organizationId,
        actorId: ctx.user.id,
        clientId: parsed.data.clientId,
        projectId: parsed.data.projectId ?? "",
        title: parsed.data.title,
        lines,
      }),
    );
    redirect(kind === "invoice" ? `/app/revenue/invoices/${created.id}` : `/app/revenue?kind=${kind}&open=${created.id}`);
  });
}

export async function transitionAction(formData: FormData) {
  const ctx = await actor("finance.write");
  const kind = String(formData.get("kind"));
  const status = String(formData.get("status"));
  const current = String(formData.get("current"));
  if (kind === "invoice") {
    if (!canTransitionInvoice(current as "draft", status as "issued")) throw new UserError("That status change is not allowed.");
    if (status === "void") {
      await withUser(ctx.user.id, (db) => voidInvoice(db, { orgId: ctx.org.organizationId, id: String(formData.get("id")) }));
    } else if (status === "issued") {
      await withUser(ctx.user.id, (db) =>
        issueInvoice(db, {
          orgId: ctx.org.organizationId,
          id: String(formData.get("id")),
          issuedOn: String(formData.get("issuedOn") || todayInTimeZone(ctx.org.timezone)),
          dueOn: String(formData.get("dueOn") ?? ""),
          actorId: ctx.user.id,
        }),
      );
    }
  } else if (kind === "estimate" || kind === "proposal") {
    if (!canTransitionCommercial(current as "draft", status as "sent")) throw new UserError("That status change is not allowed.");
    await withUser(ctx.user.id, (db) =>
      transitionCommercial(db, kind, {
        orgId: ctx.org.organizationId,
        id: String(formData.get("id")),
        status,
        issuedOn: todayInTimeZone(ctx.org.timezone),
      }),
    );
  }
  revalidatePath("/app/revenue");
}

export async function paymentAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = paymentSchema.safeParse({
    amount: formData.get("amount"),
    receivedOn: formData.get("receivedOn"),
    source: formData.get("source"),
    provider: formData.get("provider") ?? "",
    providerReference: formData.get("providerReference") ?? "",
  });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  if (parsed.data.source === "provider" && !process.env.PAYMENT_PROVIDER) {
    return { ok: false, error: "No payment provider is configured. Record a manual payment instead." };
  }
  return runAction(async () => {
    const ctx = await actor("finance.write");
    let amountMinor = 0;
    try {
      amountMinor = parseMajorToMinor(parsed.data.amount);
    } catch (error) {
      throw new UserError(error instanceof Error ? error.message : "Check the amount");
    }
    if (amountMinor <= 0) throw new UserError("Amount must be greater than zero");
    await withUser(ctx.user.id, (db) =>
      recordPayment(db, {
        orgId: ctx.org.organizationId,
        invoiceId: String(formData.get("invoiceId")),
        actorId: ctx.user.id,
        amountMinor,
        receivedOn: parsed.data.receivedOn,
        source: parsed.data.source,
        provider: parsed.data.source === "provider" ? parsed.data.provider || process.env.PAYMENT_PROVIDER || "" : "",
        providerReference: parsed.data.source === "provider" ? parsed.data.providerReference || "" : "",
      }),
    );
    revalidatePath("/app/revenue");
  });
}

export async function timeAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = timeEntrySchema.safeParse({
    projectId: formData.get("projectId"),
    taskId: formData.get("taskId") ?? "",
    userId: formData.get("userId"),
    workDate: formData.get("workDate"),
    minutes: formData.get("minutes"),
    billable: checked(formData, "billable"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  return runAction(async () => {
    const ctx = await actor("time.write");
    if (ctx.org.role === "contributor" && parsed.data.userId !== ctx.user.id) {
      throw new UserError("You can only record your own time.");
    }
    await withUser(ctx.user.id, (db) =>
      insertTime(db, {
        orgId: ctx.org.organizationId,
        projectId: parsed.data.projectId,
        taskId: parsed.data.taskId ?? "",
        userId: parsed.data.userId,
        workDate: parsed.data.workDate,
        minutes: parsed.data.minutes,
        billable: parsed.data.billable,
        note: parsed.data.note,
        canReadCost: can(ctx.org.role, "finance.internal"),
      }),
    );
    revalidatePath("/app/time");
  });
}

export async function rateAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = costRateSchema.safeParse({
    userId: formData.get("userId"),
    hourly: formData.get("hourly"),
    effectiveOn: formData.get("effectiveOn"),
  });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  return runAction(async () => {
    const ctx = await actor("finance.internal");
    let hourlyMinor = 0;
    try {
      hourlyMinor = parseMajorToMinor(parsed.data.hourly);
    } catch (error) {
      throw new UserError(error instanceof Error ? error.message : "Check the rate");
    }
    await withUser(ctx.user.id, (db) =>
      insertCostRate(db, {
        orgId: ctx.org.organizationId,
        userId: parsed.data.userId,
        hourlyMinor,
        effectiveOn: parsed.data.effectiveOn,
      }),
    );
    revalidatePath("/app/time");
  });
}

export async function budgetAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = budgetSchema.safeParse({ revenue: formData.get("revenue") ?? "", cost: formData.get("cost") ?? "" });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  return runAction(async () => {
    const ctx = await actor("finance.internal");
    const revenue = parsed.data.revenue ? parseMajorToMinor(parsed.data.revenue) : null;
    const cost = parsed.data.cost ? parseMajorToMinor(parsed.data.cost) : null;
    await withUser(ctx.user.id, (db) =>
      upsertBudget(db, { orgId: ctx.org.organizationId, projectId: String(formData.get("projectId")), revenue, cost }),
    );
    revalidatePath("/app/projects");
  });
}

export async function availabilityAction(formData: FormData) {
  const ctx = await requireOrg();
  const userId = String(formData.get("userId"));
  if (userId !== ctx.user.id && !can(ctx.org.role, "tasks.assign")) {
    throw new UserError("You do not have access to do that.");
  }
  await withUser(ctx.user.id, (db) =>
    setAvailability(db, {
      orgId: ctx.org.organizationId,
      userId,
      weekday: Number(formData.get("weekday")),
      minutes: Number(formData.get("minutes")),
    }),
  );
  revalidatePath("/app/reports/workload");
}

export async function preferenceAction(formData: FormData) {
  const kind = String(formData.get("kind"));
  if (!isNotificationKind(kind)) throw new UserError("Unknown notification kind.");
  const ctx = await requireOrg();
  await withUser(ctx.user.id, (db) =>
    savePreference(db, {
      orgId: ctx.org.organizationId,
      userId: ctx.user.id,
      kind,
      inApp: checked(formData, "inApp"),
      email: checked(formData, "email"),
      push: checked(formData, "push"),
    }),
  );
  revalidatePath("/app/settings/notifications");
}

export async function readNotificationAction(formData: FormData) {
  const ctx = await requireOrg();
  await withUser(ctx.user.id, (db) =>
    db.query(`update notifications set read_at = now() where id = $1 and user_id = $2 and read_at is null`, [
      String(formData.get("id")),
      ctx.user.id,
    ]),
  );
  revalidatePath("/app/notifications");
}

export async function milestoneAction(formData: FormData) {
  const ctx = await actor("projects.write");
  await withUser(ctx.user.id, (db) =>
    db.query(
      `insert into milestones (organization_id, project_id, name, due_on) values ($1,$2,$3, nullif($4,'')::date)`,
      [ctx.org.organizationId, String(formData.get("projectId")), String(formData.get("name")), String(formData.get("dueOn") ?? "")],
    ),
  );
  revalidatePath("/app/projects");
}

export async function labelAction(formData: FormData) {
  const ctx = await actor("projects.write");
  await withUser(ctx.user.id, (db) =>
    db.query(`insert into labels (organization_id, name, color) values ($1,$2,$3)`, [
      ctx.org.organizationId,
      String(formData.get("name")),
      String(formData.get("color") || "#8a8175"),
    ]),
  );
  await withUser(ctx.user.id, async (db) => {
    const taskId = String(formData.get("taskId") ?? "");
    if (!taskId) return;
    const labels = await db.query(`select id from labels where organization_id = $1 and name = $2`, [
      ctx.org.organizationId,
      String(formData.get("name")),
    ]);
    if (labels[0]) {
      await db.query(
        `insert into task_labels (organization_id, task_id, label_id) values ($1,$2,$3) on conflict do nothing`,
        [ctx.org.organizationId, taskId, labels[0].id],
      );
    }
  });
  revalidatePath("/app/projects");
}

export async function reportRangeAction(formData: FormData) {
  const parsed = dateRangeSchema.safeParse({ from: formData.get("from"), to: formData.get("to") });
  if (!parsed.success) redirect("/app/reports");
  redirect(`/app/reports?from=${parsed.data.from}&to=${parsed.data.to}`);
}
