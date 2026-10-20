import { randomUUID } from "node:crypto";
import type { Executor } from "@/lib/db/executor";
import { costAmountMinor, lineTotalMinor } from "@/lib/money";
import { invoiceStatusAfterPayment } from "@/lib/states";
import { asDate, asMinor, asText } from "./sql";

async function audit(
  db: Executor,
  orgId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, string> = {},
) {
  await db.query(`select private.write_audit($1::uuid, $2, $3, $4::uuid, $5::jsonb)`, [
    orgId,
    action,
    entityType,
    entityId,
    JSON.stringify(metadata),
  ]);
}

async function nextNumber(db: Executor, orgId: string, prefix: string, table: "invoices" | "estimates" | "proposals") {
  const rows = await db.query(`select number from ${table} where organization_id = $1 and number like $2`, [
    orgId,
    `${prefix}-%`,
  ]);
  let max = 1000;
  for (const row of rows) {
    const value = Number(asText(row.number).slice(prefix.length + 1));
    if (Number.isInteger(value) && value > max) max = value;
  }
  return `${prefix}-${max + 1}`;
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export async function insertClient(
  db: Executor,
  input: { orgId: string; actorId: string; name: string; stage: string; website: string; customFields: Record<string, string> },
) {
  const id = randomUUID();
  await db.query(
    `insert into clients (id, organization_id, name, stage, website, custom_fields, created_by)
     values ($1,$2,$3,$4, nullif($5,''), $6::jsonb, $7)`,
    [id, input.orgId, input.name, input.stage, input.website, JSON.stringify(input.customFields), input.actorId],
  );
  await db.query(
    `insert into client_activity (organization_id, client_id, actor_id, kind, summary) values ($1,$2,$3,'created',$4)`,
    [input.orgId, id, input.actorId, `${input.name} added`],
  );
  await audit(db, input.orgId, "client.created", "client", id, { name: input.name });
  return id;
}

export async function updateClientStage(db: Executor, input: { orgId: string; actorId: string; clientId: string; stage: string }) {
  const current = await db.query(`select stage, name from clients where id = $1 and organization_id = $2`, [input.clientId, input.orgId]);
  if (!current[0]) throw new Error("row-level security");
  await db.query(`update clients set stage = $1 where id = $2 and organization_id = $3`, [input.stage, input.clientId, input.orgId]);
  await db.query(
    `insert into client_activity (organization_id, client_id, actor_id, kind, summary) values ($1,$2,$3,'stage',$4)`,
    [input.orgId, input.clientId, input.actorId, `Stage changed from ${asText(current[0].stage)} to ${input.stage}`],
  );
}

export async function updateClientFields(
  db: Executor,
  input: { orgId: string; clientId: string; customFields: Record<string, string> },
) {
  const updated = await db.query(
    `update clients set custom_fields = $1::jsonb where id = $2 and organization_id = $3 returning id`,
    [JSON.stringify(input.customFields), input.clientId, input.orgId],
  );
  if (!updated[0]) throw new Error("row-level security");
}

export async function insertContact(db: Executor, input: { orgId: string; clientId: string; name: string; email: string; phone: string; title: string }) {
  await db.query(
    `insert into client_contacts (organization_id, client_id, name, email, phone, title)
     values ($1,$2,$3, nullif($4,''), nullif($5,''), nullif($6,''))`,
    [input.orgId, input.clientId, input.name, input.email, input.phone, input.title],
  );
}

export async function insertNote(db: Executor, input: { orgId: string; clientId: string; actorId: string; body: string; internal: boolean }) {
  await db.query(
    `insert into client_notes (organization_id, client_id, author_id, body, internal) values ($1,$2,$3,$4,$5)`,
    [input.orgId, input.clientId, input.actorId, input.body, input.internal],
  );
  await db.query(
    `insert into client_activity (organization_id, client_id, actor_id, kind, summary) values ($1,$2,$3,'note','Note added')`,
    [input.orgId, input.clientId, input.actorId],
  );
}

export async function insertFieldDefinition(
  db: Executor,
  input: { orgId: string; key: string; label: string; fieldType: string; required: boolean; options: string[] },
) {
  await db.query(
    `insert into client_field_definitions (organization_id, key, label, field_type, required, options)
     values ($1,$2,$3,$4,$5,$6)`,
    [input.orgId, input.key, input.label, input.fieldType, input.required, input.options],
  );
}

export async function createProject(
  db: Executor,
  input: {
    orgId: string;
    actorId: string;
    clientId: string;
    name: string;
    status: string;
    description: string;
    timezone: string;
    startOn: string;
    endOn: string;
    templateId: string;
  },
) {
  const id = randomUUID();
  await db.query(
    `insert into projects (id, organization_id, client_id, name, status, description, timezone, start_on, end_on, created_by)
     values ($1,$2,$3,$4,$5,$6,$7, nullif($8,'')::date, nullif($9,'')::date, $10)`,
    [id, input.orgId, input.clientId, input.name, input.status, input.description, input.timezone, input.startOn, input.endOn, input.actorId],
  );
  if (input.templateId) {
    const tasks = await db.query(
      `select key, title, detail, status, client_visible, offset_days, parent_key
       from template_tasks where template_id = $1 and organization_id = $2`,
      [input.templateId, input.orgId],
    );
    const ids = new Map<string, string>();
    for (const task of tasks) ids.set(asText(task.key), randomUUID());
    const ordered = [...tasks].sort((a, b) => Number(Boolean(a.parent_key)) - Number(Boolean(b.parent_key)));
    for (const task of ordered) {
      const key = asText(task.key);
      const due = input.startOn && task.offset_days != null ? addDays(input.startOn, Number(task.offset_days)) : "";
      const parent = task.parent_key ? ids.get(asText(task.parent_key)) ?? null : null;
      await db.query(
        `insert into tasks (id, organization_id, project_id, parent_task_id, title, detail, status, client_visible, due_on, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8, nullif($9,'')::date, $10)`,
        [ids.get(key), input.orgId, id, parent, task.title, task.detail, task.status, task.client_visible, due, input.actorId],
      );
    }
    const dependencies = await db.query(
      `select predecessor_key, successor_key from template_dependencies where template_id = $1 and organization_id = $2`,
      [input.templateId, input.orgId],
    );
    for (const dependency of dependencies) {
      await db.query(
        `insert into task_dependencies (organization_id, predecessor_id, successor_id) values ($1,$2,$3)`,
        [input.orgId, ids.get(asText(dependency.predecessor_key)), ids.get(asText(dependency.successor_key))],
      );
    }
  }
  await audit(db, input.orgId, "project.created", "project", id, { name: input.name });
  return id;
}

export async function createTask(
  db: Executor,
  input: {
    orgId: string;
    actorId: string;
    projectId: string;
    title: string;
    detail: string;
    status: string;
    clientVisible: boolean;
    dueOn: string;
    parentTaskId: string;
    milestoneId: string;
  },
) {
  const id = randomUUID();
  await db.query(
    `insert into tasks (id, organization_id, project_id, parent_task_id, milestone_id, title, detail, status, client_visible, due_on, created_by)
     values ($1,$2,$3, nullif($4,'')::uuid, nullif($5,'')::uuid, $6,$7,$8,$9, nullif($10,'')::date, $11)`,
    [id, input.orgId, input.projectId, input.parentTaskId, input.milestoneId, input.title, input.detail, input.status, input.clientVisible, input.dueOn, input.actorId],
  );
  return id;
}

export async function setTaskStatus(db: Executor, input: { orgId: string; taskId: string; status: string }) {
  const updated = await db.query(
    `update tasks set status = $1 where id = $2 and organization_id = $3 returning id`,
    [input.status, input.taskId, input.orgId],
  );
  if (!updated[0]) throw new Error("row-level security");
}

export async function addAssignee(db: Executor, input: { orgId: string; taskId: string; userId: string; title: string; href: string }) {
  await db.query(
    `insert into task_assignees (organization_id, task_id, user_id) values ($1,$2,$3) on conflict do nothing`,
    [input.orgId, input.taskId, input.userId],
  );
  await db.query(`select private.notify($1,$2,'task_assigned',$3,$4,$5)`, [
    input.orgId,
    input.userId,
    "Task assigned",
    input.title,
    input.href,
  ]);
}

export async function addDependency(db: Executor, input: { orgId: string; predecessorId: string; successorId: string }) {
  await db.query(
    `insert into task_dependencies (organization_id, predecessor_id, successor_id) values ($1,$2,$3)`,
    [input.orgId, input.predecessorId, input.successorId],
  );
}

export async function addComment(db: Executor, input: { orgId: string; taskId: string; actorId: string; body: string; internal: boolean }) {
  await db.query(
    `insert into task_comments (organization_id, task_id, author_id, body, internal) values ($1,$2,$3,$4,$5)`,
    [input.orgId, input.taskId, input.actorId, input.body, input.internal],
  );
}

export async function saveTemplate(
  db: Executor,
  input: { orgId: string; actorId: string; name: string; description: string; tasks: { key: string; title: string; offsetDays: number | null }[] },
) {
  const id = randomUUID();
  await db.query(
    `insert into project_templates (id, organization_id, name, description, created_by) values ($1,$2,$3,$4,$5)`,
    [id, input.orgId, input.name, input.description, input.actorId],
  );
  for (const task of input.tasks) {
    await db.query(
      `insert into template_tasks (organization_id, template_id, key, title, offset_days) values ($1,$2,$3,$4,$5)`,
      [input.orgId, id, task.key, task.title, task.offsetDays],
    );
  }
  return id;
}

type LineInput = { description: string; quantityMilli: number; unitMinor: number };

async function insertLines(
  db: Executor,
  table: "estimate_lines" | "proposal_lines" | "invoice_lines",
  parentColumn: "estimate_id" | "proposal_id" | "invoice_id",
  orgId: string,
  parentId: string,
  lines: LineInput[],
) {
  let position = 1;
  for (const line of lines) {
    const total = lineTotalMinor(line.quantityMilli, line.unitMinor);
    await db.query(
      `insert into ${table} (organization_id, ${parentColumn}, position, description, quantity_milli, unit_amount_minor, total_minor)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [orgId, parentId, position, line.description, line.quantityMilli, line.unitMinor, total],
    );
    position += 1;
  }
}

export async function createCommercial(
  db: Executor,
  kind: "estimate" | "proposal" | "invoice",
  input: { orgId: string; actorId: string; clientId: string; projectId: string; title: string; lines: LineInput[] },
) {
  const table = kind === "estimate" ? "estimates" : kind === "proposal" ? "proposals" : "invoices";
  const prefix = kind === "estimate" ? "EST" : kind === "proposal" ? "PRO" : "INV";
  const number = await nextNumber(db, input.orgId, prefix, table);
  const id = randomUUID();
  await db.query(
    `insert into ${table} (id, organization_id, client_id, project_id, number, title, created_by)
     values ($1,$2,$3, nullif($4,'')::uuid, $5, $6, $7)`,
    [id, input.orgId, input.clientId, input.projectId, number, input.title, input.actorId],
  );
  const lineTable = kind === "estimate" ? "estimate_lines" : kind === "proposal" ? "proposal_lines" : "invoice_lines";
  const parent = kind === "estimate" ? "estimate_id" : kind === "proposal" ? "proposal_id" : "invoice_id";
  await insertLines(db, lineTable, parent, input.orgId, id, input.lines);
  await audit(db, input.orgId, `${kind}.created`, kind, id, { number });
  return { id, number };
}

export async function transitionCommercial(
  db: Executor,
  kind: "estimate" | "proposal",
  input: { orgId: string; id: string; status: string; issuedOn: string },
) {
  const table = kind === "estimate" ? "estimates" : "proposals";
  const updated = await db.query(
    `update ${table}
     set status = $1, issued_on = case when $1 = 'sent' then nullif($2,'')::date else issued_on end
     where id = $3 and organization_id = $4
     returning id`,
    [input.status, input.issuedOn, input.id, input.orgId],
  );
  if (!updated[0]) throw new Error("row-level security");
}

export async function issueInvoice(db: Executor, input: { orgId: string; id: string; issuedOn: string; dueOn: string; actorId: string }) {
  const updated = await db.query(
    `update invoices set status = 'issued', issued_on = $1::date, due_on = nullif($2,'')::date
     where id = $3 and organization_id = $4 and status = 'draft' returning id, number, project_id`,
    [input.issuedOn, input.dueOn, input.id, input.orgId],
  );
  if (!updated[0]) throw new Error("illegal invoice transition from draft");
  await audit(db, input.orgId, "invoice.issued", "invoice", input.id, { number: asText(updated[0].number) });
  if (updated[0].project_id) {
    const members = await db.query(
      `select user_id from project_members where organization_id = $1 and project_id = $2 and user_id <> $3`,
      [input.orgId, updated[0].project_id, input.actorId],
    );
    for (const member of members) {
      await db.query(`select private.notify($1,$2,'invoice_issued',$3,$4,$5)`, [
        input.orgId,
        member.user_id,
        `Invoice ${asText(updated[0].number)} issued`,
        "A project invoice left draft.",
        `/app/revenue/invoices/${input.id}`,
      ]);
    }
  }
}

export async function voidInvoice(db: Executor, input: { orgId: string; id: string }) {
  const updated = await db.query(
    `update invoices set status = 'void' where id = $1 and organization_id = $2 returning id`,
    [input.id, input.orgId],
  );
  if (!updated[0]) throw new Error("row-level security");
}

export async function recordPayment(
  db: Executor,
  input: {
    orgId: string;
    invoiceId: string;
    actorId: string;
    amountMinor: number;
    receivedOn: string;
    source: "manual" | "provider";
    provider: string;
    providerReference: string;
  },
) {
  const rows = await db.query(
    `select status,
            coalesce((select sum(total_minor) from invoice_lines l where l.invoice_id = i.id), 0) as total_minor,
            coalesce((select sum(amount_minor) from payments p where p.invoice_id = i.id), 0) as paid_minor
     from invoices i where i.id = $1 and i.organization_id = $2 for update`,
    [input.invoiceId, input.orgId],
  );
  if (!rows[0]) throw new Error("row-level security");
  const total = asMinor(rows[0].total_minor);
  const paid = asMinor(rows[0].paid_minor);
  const nextPaid = paid + input.amountMinor;
  const status = invoiceStatusAfterPayment(total, nextPaid);
  await db.query(
    `insert into payments (organization_id, invoice_id, amount_minor, source, provider, provider_reference, received_on, recorded_by)
     values ($1,$2,$3,$4, nullif($5,''), nullif($6,''), $7::date, $8)`,
    [input.orgId, input.invoiceId, input.amountMinor, input.source, input.provider, input.providerReference, input.receivedOn, input.actorId],
  );
  await db.query(`update invoices set status = $1 where id = $2 and organization_id = $3`, [status, input.invoiceId, input.orgId]);
  await audit(db, input.orgId, "payment.recorded", "payment", input.invoiceId, {
    source: input.source,
    amount: String(input.amountMinor),
  });
  return { status, balanceMinor: total - nextPaid, totalMinor: total, paidMinor: nextPaid };
}

export async function insertTime(
  db: Executor,
  input: {
    orgId: string;
    projectId: string;
    taskId: string;
    userId: string;
    workDate: string;
    minutes: number;
    billable: boolean;
    note: string;
    canReadCost: boolean;
  },
) {
  const id = randomUUID();
  await db.query(
    `insert into time_entries (id, organization_id, project_id, task_id, user_id, work_date, minutes, billable, note)
     values ($1,$2,$3, nullif($4,'')::uuid, $5, $6::date, $7, $8, $9)`,
    [id, input.orgId, input.projectId, input.taskId, input.userId, input.workDate, input.minutes, input.billable, input.note],
  );
  if (input.canReadCost) {
    const rates = await db.query(
      `select hourly_rate_minor from cost_rates
       where organization_id = $1 and user_id = $2 and effective_on <= $3::date
       order by effective_on desc limit 1`,
      [input.orgId, input.userId, input.workDate],
    );
    if (rates[0]) {
      const rate = asMinor(rates[0].hourly_rate_minor);
      await db.query(
        `insert into time_entry_costs (organization_id, time_entry_id, hourly_rate_minor, cost_amount_minor)
         values ($1,$2,$3,$4)`,
        [input.orgId, id, rate, costAmountMinor(input.minutes, rate)],
      );
    }
  }
  return id;
}

export async function insertCostRate(db: Executor, input: { orgId: string; userId: string; hourlyMinor: number; effectiveOn: string }) {
  await db.query(
    `insert into cost_rates (organization_id, user_id, hourly_rate_minor, effective_on) values ($1,$2,$3,$4::date)`,
    [input.orgId, input.userId, input.hourlyMinor, input.effectiveOn],
  );
}

export async function upsertBudget(
  db: Executor,
  input: { orgId: string; projectId: string; revenue: number | null; cost: number | null },
) {
  await db.query(
    `insert into project_budgets (organization_id, project_id, revenue_budget_minor, cost_budget_minor)
     values ($1,$2,$3,$4)
     on conflict (project_id) do update set revenue_budget_minor = excluded.revenue_budget_minor,
       cost_budget_minor = excluded.cost_budget_minor, updated_at = now()`,
    [input.orgId, input.projectId, input.revenue, input.cost],
  );
}

export async function setAvailability(db: Executor, input: { orgId: string; userId: string; weekday: number; minutes: number }) {
  await db.query(
    `insert into availability_windows (organization_id, user_id, weekday, minutes) values ($1,$2,$3,$4)
     on conflict (organization_id, user_id, weekday) do update set minutes = excluded.minutes`,
    [input.orgId, input.userId, input.weekday, input.minutes],
  );
}

export async function savePreference(
  db: Executor,
  input: { orgId: string; userId: string; kind: string; inApp: boolean; email: boolean; push: boolean },
) {
  await db.query(
    `insert into notification_preferences (organization_id, user_id, kind, in_app, email, push)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (organization_id, user_id, kind) do update
     set in_app = excluded.in_app, email = excluded.email, push = excluded.push`,
    [input.orgId, input.userId, input.kind, input.inApp, input.email, input.push],
  );
}

export function balanceOf(totalMinor: number, paidMinor: number): number {
  return totalMinor - paidMinor;
}

export { asDate, asText };
