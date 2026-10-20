import Link from "next/link";
import { Money, PageHeader, Empty } from "@/components/ui";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { financialReport } from "@/lib/reports";
import { todayInTimeZone } from "@/lib/time";
import { requireOrg } from "@/server/context";
import { asText } from "@/server/load";
import { loadFinancialSnapshots } from "@/server/sql";

export default async function HomePage() {
  const { user, org } = await requireOrg();
  const today = todayInTimeZone(org.timezone);
  const from = `${today.slice(0, 7)}-01`;
  const finance = can(org.role, "reports.financial");
  const snapshots = finance
    ? await withUser(user.id, (db) => loadFinancialSnapshots(db, org.organizationId))
    : { invoices: [], payments: [], costs: [] };
  const report = financialReport({ from, to: today, ...snapshots });
  const tasks = await withUser(user.id, (db) =>
    db.query(
      `select t.id, t.title, t.status, p.id as project_id, p.name as project_name
       from tasks t
       join projects p on p.id = t.project_id
       left join task_assignees a on a.task_id = t.id
       where t.organization_id = $1 and t.status <> 'done' and ($2 = 'client' or a.user_id = $3)
       order by t.due_on nulls last limit 8`,
      [org.organizationId, org.role, user.id],
    ),
  );
  return (
    <>
      <PageHeader crumbs={[{ label: org.name }]} title="Today" />
      <p className="muted">Dates use {org.timezone}. Currency is {org.currency} for the whole organization.</p>
      {finance ? (
        report.empty ? (
          <Empty title="No revenue activity this month" body="Issued invoices, payments, and delivery cost will show here when they exist. Nothing is filled in." />
        ) : (
          <section className="grid-3">
            <article className="panel stat"><span className="muted">Recognized</span><b><Money minor={report.recognizedMinor} currency={org.currency} /></b></article>
            <article className="panel stat"><span className="muted">Outstanding</span><b><Money minor={report.outstandingMinor} currency={org.currency} /></b></article>
            <article className="panel stat"><span className="muted">Collected</span><b><Money minor={report.collectedMinor} currency={org.currency} /></b></article>
          </section>
        )
      ) : null}
      <section className="panel">
        <h2>{org.role === "client" ? "Visible open tasks" : "Your open tasks"}</h2>
        {tasks.length === 0 ? <p className="muted">No open tasks in view.</p> : (
          <ul>
            {tasks.map((task) => (
              <li key={asText(task.id)}>
                <Link href={`/app/projects/${asText(task.project_id)}/tasks/${asText(task.id)}`}>{asText(task.title)}</Link>
                <span className="muted"> · {asText(task.project_name)} · {asText(task.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
