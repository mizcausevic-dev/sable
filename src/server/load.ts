import "server-only";
import { withUser } from "@/lib/db";
import type { FieldDefinition } from "@/lib/custom-fields";
import { asDate, asMinor, asMinorOrNull, asText, likeContains } from "./sql";

function bool(value: unknown): boolean {
  return value === true;
}

export async function loadClients(userId: string, orgId: string, query: string) {
  return withUser(userId, (db) =>
    db.query(
      `select id, name, stage, website from clients
       where organization_id = $1 and ($2 = '' or name ilike $3)
       order by name`,
      [orgId, query, likeContains(query)],
    ),
  );
}

export async function loadClient(userId: string, orgId: string, clientId: string) {
  return withUser(userId, async (db) => {
    const clients = await db.query(
      `select id, name, stage, website, custom_fields from clients where id = $1 and organization_id = $2`,
      [clientId, orgId],
    );
    if (!clients[0]) return null;
    const [contacts, notes, activity, files, projects, definitions] = await Promise.all([
      db.query(`select id, name, email, phone, title from client_contacts where client_id = $1 order by name`, [clientId]),
      db.query(`select id, body, internal, created_at from client_notes where client_id = $1 order by created_at desc`, [clientId]),
      db.query(`select id, kind, summary, created_at from client_activity where client_id = $1 order by created_at desc`, [clientId]),
      db.query(
        `select id, filename, mime_type, byte_size, internal, created_at from attachments
         where organization_id = $1 and entity_type = 'client' and entity_id = $2 order by created_at desc`,
        [orgId, clientId],
      ),
      db.query(`select id, name from projects where client_id = $1 order by name`, [clientId]),
      db.query(
        `select key, label, field_type, required, options, archived from client_field_definitions where organization_id = $1 and archived = false order by label`,
        [orgId],
      ),
    ]);
    return { client: clients[0], contacts, notes, activity, files, projects, definitions };
  });
}

export function mapDefinitions(rows: Record<string, unknown>[]): FieldDefinition[] {
  return rows.map((row) => ({
    key: asText(row.key),
    label: asText(row.label),
    fieldType: asText(row.field_type) as FieldDefinition["fieldType"],
    required: bool(row.required),
    options: Array.isArray(row.options) ? row.options.map(String) : [],
    archived: bool(row.archived),
  }));
}

export async function loadProjects(userId: string, orgId: string) {
  return withUser(userId, (db) =>
    db.query(
      `select p.id, p.name, p.status, p.start_on::text as start_on, p.end_on::text as end_on, c.name as client_name
       from projects p join clients c on c.id = p.client_id
       where p.organization_id = $1
       order by p.name`,
      [orgId],
    ),
  );
}

export async function loadProject(userId: string, orgId: string, projectId: string) {
  return withUser(userId, async (db) => {
    const projects = await db.query(
      `select p.id, p.name, p.status, p.description, p.timezone, p.start_on::text as start_on, p.end_on::text as end_on,
              p.client_id, c.name as client_name
       from projects p join clients c on c.id = p.client_id
       where p.id = $1 and p.organization_id = $2`,
      [projectId, orgId],
    );
    if (!projects[0]) return null;
    const [tasks, milestones, files, budget, members] = await Promise.all([
      db.query(
        `select t.id, t.title, t.status, t.due_on::text as due_on, t.client_visible, t.parent_task_id,
                coalesce(string_agg(u.name, ', ' order by u.name), '') as assignees
         from tasks t
         left join task_assignees a on a.task_id = t.id
         left join users u on u.id = a.user_id
         where t.project_id = $1
         group by t.id
         order by t.due_on nulls last, t.title`,
        [projectId],
      ),
      db.query(`select id, name, due_on::text as due_on from milestones where project_id = $1 order by due_on nulls last`, [projectId]),
      db.query(
        `select id, filename, mime_type, byte_size, internal from attachments
         where organization_id = $1 and entity_type = 'project' and entity_id = $2`,
        [orgId, projectId],
      ),
      db.query(
        `select revenue_budget_minor, cost_budget_minor from project_budgets where project_id = $1`,
        [projectId],
      ),
      db.query(
        `select u.id, u.name from project_members pm join users u on u.id = pm.user_id where pm.project_id = $1 order by u.name`,
        [projectId],
      ),
    ]);
    return { project: projects[0], tasks, milestones, files, budget: budget[0] ?? null, members };
  });
}

export async function loadTask(userId: string, orgId: string, taskId: string) {
  return withUser(userId, async (db) => {
    const tasks = await db.query(
      `select t.id, t.project_id, t.title, t.detail, t.status, t.client_visible, t.due_on::text as due_on, t.parent_task_id,
              p.name as project_name, p.timezone
       from tasks t join projects p on p.id = t.project_id
       where t.id = $1 and t.organization_id = $2`,
      [taskId, orgId],
    );
    if (!tasks[0]) return null;
    const projectId = asText(tasks[0].project_id);
    const [comments, dependencies, siblings, assignees, milestones] = await Promise.all([
      db.query(
        `select c.id, c.body, c.internal, c.created_at, u.name as author
         from task_comments c join users u on u.id = c.author_id
         where c.task_id = $1 order by c.created_at`,
        [taskId],
      ),
      db.query(
        `select d.predecessor_id, d.successor_id, p.title as predecessor, s.title as successor
         from task_dependencies d
         join tasks p on p.id = d.predecessor_id
         join tasks s on s.id = d.successor_id
         where d.predecessor_id = $1 or d.successor_id = $1`,
        [taskId],
      ),
      db.query(`select id, title from tasks where project_id = $1 and id <> $2 order by title`, [projectId, taskId]),
      db.query(
        `select u.id, u.name from task_assignees a join users u on u.id = a.user_id where a.task_id = $1`,
        [taskId],
      ),
      db.query(`select id, name from milestones where project_id = $1 order by name`, [projectId]),
    ]);
    return { task: tasks[0], comments, dependencies, siblings, assignees, milestones };
  });
}

export async function loadTemplates(userId: string, orgId: string) {
  return withUser(userId, (db) =>
    db.query(`select id, name, description from project_templates where organization_id = $1 order by name`, [orgId]),
  );
}

export async function loadRevenue(userId: string, orgId: string) {
  return withUser(userId, async (db) => {
    const select = (table: string) =>
      db.query(
        `select id, number, title, status, issued_on::text as issued_on, client_id from ${table} where organization_id = $1 order by created_at desc`,
        [orgId],
      );
    const [estimates, proposals, invoices, clients, projects] = await Promise.all([
      select("estimates"),
      select("proposals"),
      db.query(
        `select i.id, i.number, i.title, i.status, i.issued_on::text as issued_on, i.due_on::text as due_on,
                coalesce((select sum(total_minor) from invoice_lines l where l.invoice_id = i.id), 0) as total_minor,
                coalesce((select sum(amount_minor) from payments p where p.invoice_id = i.id), 0) as paid_minor
         from invoices i where i.organization_id = $1 order by i.created_at desc`,
        [orgId],
      ),
      db.query(`select id, name from clients where organization_id = $1 order by name`, [orgId]),
      db.query(`select id, name, client_id from projects where organization_id = $1 order by name`, [orgId]),
    ]);
    return { estimates, proposals, invoices, clients, projects };
  });
}

export async function loadInvoice(userId: string, orgId: string, invoiceId: string) {
  return withUser(userId, async (db) => {
    const invoices = await db.query(
      `select i.id, i.number, i.title, i.status, i.issued_on::text as issued_on, i.due_on::text as due_on, i.project_id, c.name as client_name
       from invoices i join clients c on c.id = i.client_id
       where i.id = $1 and i.organization_id = $2`,
      [invoiceId, orgId],
    );
    if (!invoices[0]) return null;
    const [lines, payments] = await Promise.all([
      db.query(
        `select description, quantity_milli, unit_amount_minor, total_minor from invoice_lines where invoice_id = $1 order by position`,
        [invoiceId],
      ),
      db.query(
        `select id, amount_minor, source, provider, provider_reference, received_on::text as received_on, created_at
         from payments where invoice_id = $1 order by received_on, created_at`,
        [invoiceId],
      ),
    ]);
    return { invoice: invoices[0], lines, payments };
  });
}

export async function loadTime(userId: string, orgId: string) {
  return withUser(userId, async (db) => {
    const [entries, projects, rates, staff] = await Promise.all([
      db.query(
        `select t.id, t.work_date::text as work_date, t.minutes, t.billable, t.note, p.name as project_name, u.name as user_name,
                c.cost_amount_minor
         from time_entries t
         join projects p on p.id = t.project_id
         join users u on u.id = t.user_id
         left join time_entry_costs c on c.time_entry_id = t.id
         where t.organization_id = $1
         order by t.work_date desc, u.name`,
        [orgId],
      ),
      db.query(`select id, name from projects where organization_id = $1 order by name`, [orgId]),
      db.query(
        `select r.user_id, u.name, r.hourly_rate_minor, r.effective_on::text as effective_on
         from cost_rates r join users u on u.id = r.user_id
         where r.organization_id = $1 order by r.effective_on desc`,
        [orgId],
      ),
      db.query(
        `select u.id, u.name from memberships m join users u on u.id = m.user_id
         where m.organization_id = $1 and m.role in ('owner','admin','manager','contributor') order by u.name`,
        [orgId],
      ),
    ]);
    return { entries, projects, rates, staff };
  });
}

export async function loadMembers(userId: string, orgId: string) {
  return withUser(userId, async (db) => {
    const [members, invitations, clients, projects] = await Promise.all([
      db.query(
        `select u.id, u.name, u.email, m.role from memberships m join users u on u.id = m.user_id
         where m.organization_id = $1 order by u.name`,
        [orgId],
      ),
      db.query(
        `select id, email, role, expires_at, accepted_at, revoked_at from invitations
         where organization_id = $1 order by created_at desc`,
        [orgId],
      ),
      db.query(`select id, name from clients where organization_id = $1 order by name`, [orgId]),
      db.query(`select id, name, client_id from projects where organization_id = $1 order by name`, [orgId]),
    ]);
    return { members, invitations, clients, projects };
  });
}

export async function loadNotifications(userId: string) {
  return withUser(userId, (db) =>
    db.query(
      `select id, kind, title, body, href, read_at, created_at from notifications
       where user_id = $1 order by created_at desc limit 50`,
      [userId],
    ),
  );
}

export async function loadPreferences(userId: string, orgId: string) {
  return withUser(userId, (db) =>
    db.query(
      `select kind, in_app, email, push from notification_preferences where user_id = $1 and organization_id = $2`,
      [userId, orgId],
    ),
  );
}

export async function loadAudit(userId: string, orgId: string) {
  return withUser(userId, (db) =>
    db.query(
      `select a.created_at, a.action, a.entity_type, a.entity_id, u.name as actor
       from audit_events a left join users u on u.id = a.actor_id
       where a.organization_id = $1 order by a.created_at desc limit 100`,
      [orgId],
    ),
  );
}

export async function loadSubscription(userId: string, orgId: string) {
  return withUser(userId, (db) =>
    db.query(
      `select s.plan, s.status, s.provider, s.seat_limit, s.project_limit, s.storage_limit_bytes,
              (select count(*) from memberships m where m.organization_id = s.organization_id) as seats,
              (select count(*) from projects p where p.organization_id = s.organization_id) as projects,
              (select coalesce(sum(byte_size),0) from attachments a where a.organization_id = s.organization_id) as bytes
       from subscriptions s where s.organization_id = $1`,
      [orgId],
    ),
  );
}

export async function loadWorkload(userId: string, orgId: string, selfOnly: boolean) {
  return withUser(userId, (db) =>
    db.query(
      `select u.id, u.name,
              (select count(*)::int from task_assignees a join tasks t on t.id = a.task_id
                where a.user_id = u.id and a.organization_id = $1 and t.status <> 'done') as open_tasks,
              (select coalesce(sum(minutes),0)::int from availability_windows w
                where w.user_id = u.id and w.organization_id = $1) as minutes,
              (select count(*)::int from availability_windows w
                where w.user_id = u.id and w.organization_id = $1) as windows
       from users u
       join memberships m on m.user_id = u.id and m.organization_id = $1
       where m.role in ('owner','admin','manager','contributor')
         and ($2::boolean = false or u.id = $3)
       order by u.name`,
      [orgId, selfOnly, userId],
    ),
  );
}

export async function searchRecords(userId: string, orgId: string, query: string) {
  if (query.trim().length < 1) return [];
  const pattern = likeContains(query);
  return withUser(userId, (db) =>
    db.query(
      `select * from (
         select 'Client' as kind, id::text, name as label, '/app/clients/' || id as href from clients
           where organization_id = $1 and name ilike $2
         union all
         select 'Project', id::text, name, '/app/projects/' || id from projects
           where organization_id = $1 and name ilike $2
         union all
         select 'Invoice', id::text, number || ' · ' || title, '/app/revenue/invoices/' || id from invoices
           where organization_id = $1 and (number ilike $2 or title ilike $2)
       ) hits limit 12`,
      [orgId, pattern],
    ),
  );
}

export async function unreadCount(userId: string) {
  const rows = await withUser(userId, (db) =>
    db.query(`select count(*)::int as n from notifications where user_id = $1 and read_at is null`, [userId]),
  );
  return Number(rows[0]?.n ?? 0);
}

export { asText, asDate, asMinor, asMinorOrNull };
