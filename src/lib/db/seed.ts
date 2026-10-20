import { costAmountMinor, lineTotalMinor } from "../money";
import { SEED_PASSWORD, SEED_SALT, hashPassword } from "../password";
import { IDS } from "../seed/ids";
import { writeStoredFile } from "../storage";
import type { Executor } from "./executor";

const discovery = lineTotalMinor(1000, 450_000);
const design = lineTotalMinor(12_000, 15_000);
const draftLine = lineTotalMinor(1000, 100_000);
const harborLine = lineTotalMinor(1000, 50_000);
const timeCost = costAmountMinor(360, 8_500);

async function insert(db: Executor, text: string, params: readonly unknown[] = []) {
  await db.query(text, params);
}

export async function seed(db: Executor): Promise<void> {
  const password = hashPassword(SEED_PASSWORD, SEED_SALT);
  const people = [
    [IDS.mira, "mira.ellison@northline.test", "Mira Ellison"],
    [IDS.jonah, "jonah.adler@northline.test", "Jonah Adler"],
    [IDS.leo, "leo.park@northline.test", "Leo Park"],
    [IDS.ava, "ava.quinn@brightparcel.test", "Ava Quinn"],
    [IDS.owen, "owen.marsh@harbor.test", "Owen Marsh"],
  ] as const;
  for (const [id, email, name] of people) {
    await insert(db, `select private.register_user_with_id($1::uuid, $2, $3, $4)`, [id, email, name, password]);
  }

  await insert(
    db,
    `insert into organizations (id, name, slug, currency, timezone, created_by) values
      ($1, 'Northline Studio', 'northline', 'USD', 'America/Chicago', $2),
      ($3, 'Harbor & Co', 'harbor', 'USD', 'America/New_York', $4)`,
    [IDS.northline, IDS.mira, IDS.harbor, IDS.owen],
  );
  await insert(
    db,
    `insert into memberships (organization_id, user_id, role) values ($1,$2,'owner'), ($3,$4,'owner')`,
    [IDS.northline, IDS.mira, IDS.harbor, IDS.owen],
  );
  await insert(
    db,
    `insert into subscriptions (organization_id, plan, status, provider, seat_limit, project_limit, storage_limit_bytes)
     values ($1,'trial','trialing','mock',5,10,1073741824), ($2,'studio','active','mock',15,40,10737418240)`,
    [IDS.northline, IDS.harbor],
  );
  await insert(
    db,
    `insert into memberships (organization_id, user_id, role) values
      ($1,$2,'admin'), ($1,$3,'contributor'), ($1,$4,'client'), ($5,$2,'contributor')`,
    [IDS.northline, IDS.jonah, IDS.leo, IDS.ava, IDS.harbor],
  );

  await insert(
    db,
    `insert into client_field_definitions (organization_id, key, label, field_type, required, options)
     values ($1,'industry','Industry','select',true, array['Logistics','Publishing','Other'])`,
    [IDS.northline],
  );
  await insert(
    db,
    `insert into clients (id, organization_id, name, stage, website, custom_fields, created_by) values
      ($1,$2,'Bright Parcel','active','https://brightparcel.example', $3::jsonb, $4),
      ($5,$2,'Kindred Press','lead',null, $6::jsonb, $4),
      ($7,$8,'Lumen Market','active',null,'{}'::jsonb, $9)`,
    [
      IDS.bright,
      IDS.northline,
      JSON.stringify({ industry: "Logistics" }),
      IDS.mira,
      IDS.kindred,
      JSON.stringify({ industry: "Publishing" }),
      IDS.lumen,
      IDS.harbor,
      IDS.owen,
    ],
  );
  await insert(
    db,
    `insert into client_contacts (organization_id, client_id, name, email, title) values
      ($1,$2,'Priya Shah','priya.shah@brightparcel.test','Director of operations')`,
    [IDS.northline, IDS.bright],
  );
  await insert(
    db,
    `insert into client_notes (organization_id, client_id, author_id, body, internal) values
      ($1,$2,$3,'Rate card stays off the portal.', true),
      ($1,$2,$3,'Kickoff is on the October calendar.', false)`,
    [IDS.northline, IDS.bright, IDS.mira],
  );
  await insert(
    db,
    `insert into client_activity (organization_id, client_id, actor_id, kind, summary) values
      ($1,$2,$3,'created','Bright Parcel added'),
      ($1,$2,$3,'stage','Stage set to active')`,
    [IDS.northline, IDS.bright, IDS.mira],
  );

  await insert(
    db,
    `insert into projects (id, organization_id, client_id, name, status, description, timezone, start_on, end_on, created_by) values
      ($1,$2,$3,'Parcel tracking refresh','active','Replace the status board and the client-facing copy.','America/Chicago','2026-10-01','2026-10-31',$4),
      ($5,$2,$6,'Studio operations cleanup','planned','Internal scheduling cleanup. Not on the Bright Parcel portal.','America/Chicago','2026-10-06','2026-11-15',$4),
      ($7,$8,$9,'Lumen spring catalog','active','Harbor catalog production.','America/New_York','2026-10-01','2026-12-15',$10)`,
    [IDS.parcel, IDS.northline, IDS.bright, IDS.mira, IDS.internal, IDS.kindred, IDS.lumenProject, IDS.harbor, IDS.lumen, IDS.owen],
  );
  await insert(
    db,
    `insert into client_access (organization_id, client_id, user_id) values ($1,$2,$3)`,
    [IDS.northline, IDS.bright, IDS.ava],
  );
  await insert(
    db,
    `insert into project_access (organization_id, project_id, user_id) values ($1,$2,$3)`,
    [IDS.northline, IDS.parcel, IDS.ava],
  );
  await insert(
    db,
    `insert into project_members (organization_id, project_id, user_id) values ($1,$2,$3), ($1,$2,$4)`,
    [IDS.northline, IDS.parcel, IDS.mira, IDS.leo],
  );
  await insert(
    db,
    `insert into project_budgets (organization_id, project_id, revenue_budget_minor, cost_budget_minor) values
      ($1,$2,700000,120000), ($1,$3,null,20000)`,
    [IDS.northline, IDS.parcel, IDS.internal],
  );

  await insert(
    db,
    `insert into milestones (id, organization_id, project_id, name, due_on) values ($1,$2,$3,'Beta','2026-10-24')`,
    [IDS.milestone, IDS.northline, IDS.parcel],
  );
  await insert(
    db,
    `insert into labels (id, organization_id, name, color) values ($1,$2,'Launch','#c47b3a')`,
    [IDS.labelLaunch, IDS.northline],
  );
  await insert(
    db,
    `insert into tasks (id, organization_id, project_id, milestone_id, title, detail, status, client_visible, due_on, created_by) values
      ($1,$2,$3,null,'Write the tracking spec','Scope the events the board has to show.','done',false,'2026-10-08',$4),
      ($5,$2,$3,$6,'Build the status board','Ship the board against the spec.','ready',true,'2026-10-17',$4)`,
    [IDS.spec, IDS.northline, IDS.parcel, IDS.leo, IDS.board, IDS.milestone],
  );
  await insert(
    db,
    `insert into tasks (id, organization_id, project_id, parent_task_id, title, detail, status, client_visible, due_on, created_by)
     values ($1,$2,$3,$4,'Confirm copy with the client','Portal-visible subtask.','backlog',true,'2026-10-20',$5)`,
    [IDS.copy, IDS.northline, IDS.parcel, IDS.board, IDS.mira],
  );
  await insert(
    db,
    `insert into task_assignees (organization_id, task_id, user_id) values ($1,$2,$3), ($1,$4,$3)`,
    [IDS.northline, IDS.spec, IDS.leo, IDS.board],
  );
  await insert(
    db,
    `insert into task_labels (organization_id, task_id, label_id) values ($1,$2,$3)`,
    [IDS.northline, IDS.board, IDS.labelLaunch],
  );
  await insert(
    db,
    `insert into task_dependencies (organization_id, predecessor_id, successor_id) values ($1,$2,$3)`,
    [IDS.northline, IDS.spec, IDS.board],
  );
  await insert(
    db,
    `insert into task_comments (organization_id, task_id, author_id, body, internal) values
      ($1,$2,$3,'Internal: do not publish the cost rate with this task.', true),
      ($1,$2,$3,'The first column is delayed, in transit, and delivered.', false)`,
    [IDS.northline, IDS.board, IDS.mira],
  );

  await insert(
    db,
    `insert into project_templates (id, organization_id, name, description, created_by)
     values ($1,$2,'Launch sprint','Two-step launch used by Northline.', $3)`,
    [IDS.template, IDS.northline, IDS.mira],
  );
  await insert(
    db,
    `insert into template_tasks (organization_id, template_id, key, title, status, client_visible, offset_days) values
      ($1,$2,'brief','Write the brief','backlog',false,3),
      ($1,$2,'review','Review with the client','ready',true,8)`,
    [IDS.northline, IDS.template],
  );
  await insert(
    db,
    `insert into template_dependencies (organization_id, template_id, predecessor_key, successor_key) values ($1,$2,'brief','review')`,
    [IDS.northline, IDS.template],
  );

  await insert(
    db,
    `insert into invoices (id, organization_id, client_id, project_id, number, status, title, created_by) values
      ($1,$2,$3,$4,'INV-1042','draft','Parcel tracking, October',$5),
      ($6,$2,$3,$4,'INV-1043','draft','Unused draft',$5),
      ($7,$8,$9,$10,'INV-2001','draft','Lumen catalog deposit',$11)`,
    [
      IDS.invoice, IDS.northline, IDS.bright, IDS.parcel, IDS.mira,
      IDS.draftInvoice, IDS.harborInvoice, IDS.harbor, IDS.lumen, IDS.lumenProject, IDS.owen,
    ],
  );
  await insert(
    db,
    `insert into invoice_lines (organization_id, invoice_id, position, description, quantity_milli, unit_amount_minor, total_minor) values
      ($1,$2,1,'Discovery',1000,450000,$3),
      ($1,$2,2,'Interface design',12000,15000,$4),
      ($1,$5,1,'Unused draft line',1000,100000,$6),
      ($7,$8,1,'Catalog deposit',1000,50000,$9)`,
    [IDS.northline, IDS.invoice, discovery, design, IDS.draftInvoice, draftLine, IDS.harbor, IDS.harborInvoice, harborLine],
  );
  await insert(
    db,
    `update invoices set status='issued', issued_on='2026-10-01', due_on='2026-10-31' where id=$1`,
    [IDS.invoice],
  );
  await insert(
    db,
    `update invoices set status='issued', issued_on='2026-10-02', due_on='2026-10-20' where id=$1`,
    [IDS.harborInvoice],
  );
  await insert(
    db,
    `insert into payments (id, organization_id, invoice_id, amount_minor, source, received_on, recorded_by) values
      ($1,$2,$3,200000,'manual','2026-10-05',$4),
      ($5,$6,$7,50000,'manual','2026-10-06',$8)`,
    [IDS.payment, IDS.northline, IDS.invoice, IDS.mira, IDS.harborPayment, IDS.harbor, IDS.harborInvoice, IDS.owen],
  );
  await insert(db, `update invoices set status='partial' where id=$1`, [IDS.invoice]);
  await insert(db, `update invoices set status='paid' where id=$1`, [IDS.harborInvoice]);

  await insert(
    db,
    `insert into cost_rates (organization_id, user_id, hourly_rate_minor, effective_on) values ($1,$2,8500,'2026-10-01')`,
    [IDS.northline, IDS.leo],
  );
  await insert(
    db,
    `insert into time_entries (id, organization_id, project_id, task_id, user_id, work_date, minutes, billable, note) values
      ($1,$2,$3,$4,$5,'2026-10-03',360,true,'Spec and board structure')`,
    [IDS.time, IDS.northline, IDS.parcel, IDS.spec, IDS.leo],
  );
  await insert(
    db,
    `insert into time_entry_costs (organization_id, time_entry_id, hourly_rate_minor, cost_amount_minor) values ($1,$2,8500,$3)`,
    [IDS.northline, IDS.time, timeCost],
  );

  for (const weekday of [1, 2, 3, 4, 5]) {
    await insert(
      db,
      `insert into availability_windows (organization_id, user_id, weekday, minutes) values ($1,$2,$3,480)`,
      [IDS.northline, IDS.mira, weekday],
    );
  }

  const storageKey = `${IDS.northline}/${IDS.attachment}`;
  const fileBody = new TextEncoder().encode("Parcel tracking brief. Fictional seed file.\n");
  await writeStoredFile(storageKey, fileBody);
  await insert(
    db,
    `insert into attachments (id, organization_id, entity_type, entity_id, storage_key, filename, mime_type, byte_size, internal, uploaded_by)
     values ($1,$2,'project',$3,$4,'parcel-brief.txt','text/plain',$5,false,$6)`,
    [IDS.attachment, IDS.northline, IDS.parcel, storageKey, fileBody.byteLength, IDS.mira],
  );

  await insert(
    db,
    `insert into notifications (organization_id, user_id, kind, title, body, href) values
      ($1,$2,'task_assigned','Build the status board','Mira assigned this task to you.','/app/projects/${IDS.parcel}/tasks/${IDS.board}')`,
    [IDS.northline, IDS.leo],
  );
  await insert(
    db,
    `insert into notification_preferences (organization_id, user_id, kind, in_app, email, push) values
      ($1,$2,'task_assigned',true,true,false)`,
    [IDS.northline, IDS.leo],
  );
  await insert(
    db,
    `insert into invitations (organization_id, email, role, token_hash, expires_at, invited_by, revoked_at) values
      ($1,'old.invite@northline.test','contributor',$2, now() - interval '2 days', $3, now() - interval '1 day')`,
    [IDS.northline, "revoked-seed-token-hash", IDS.mira],
  );
  await insert(
    db,
    `insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata) values
      ($1,$2,'organization.created','organization',$1,'{"slug":"northline"}'::jsonb),
      ($1,$2,'client.created','client',$3,'{"name":"Bright Parcel"}'::jsonb),
      ($4,$5,'organization.created','organization',$4,'{"slug":"harbor"}'::jsonb)`,
    [IDS.northline, IDS.mira, IDS.bright, IDS.harbor, IDS.owen],
  );
}

export async function seedIfEmpty(db: Executor): Promise<void> {
  const table = await db.query<{ name: string | null }>(`select to_regclass('public.users') as name`);
  if (!table[0]?.name) return;
  const count = await db.query<{ n: number | string }>(`select count(*)::int as n from users`);
  if (Number(count[0]?.n ?? 0) > 0) return;
  await db.transaction((tx) => seed(tx));
}
