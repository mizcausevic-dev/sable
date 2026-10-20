import Link from "next/link";
import { Denied, Money, PageHeader } from "@/components/ui";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { budgetRows } from "@/lib/reports";
import { todayInTimeZone } from "@/lib/time";
import { requireOrg } from "@/server/context";
import { asMinorOrNull, asText } from "@/server/load";
import { loadFinancialSnapshots } from "@/server/sql";

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { user, org } = await requireOrg();
  if (!can(org.role, "finance.internal")) return <Denied what="read internal budgets" />;
  const today = todayInTimeZone(org.timezone);
  const query = await searchParams;
  const from = query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : `${today.slice(0, 7)}-01`;
  const to = query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? query.to : today;
  const [projects, snapshots] = await Promise.all([
    withUser(user.id, (db) => db.query(
      `select p.id, p.name, b.revenue_budget_minor, b.cost_budget_minor
       from projects p left join project_budgets b on b.project_id = p.id
       where p.organization_id = $1 order by p.name`,
      [org.organizationId],
    )),
    withUser(user.id, (db) => loadFinancialSnapshots(db, org.organizationId)),
  ]);
  const rows = budgetRows({
    from,
    to,
    projects: projects.map((project) => ({
      id: asText(project.id),
      name: asText(project.name),
      revenueBudgetMinor: asMinorOrNull(project.revenue_budget_minor),
      costBudgetMinor: asMinorOrNull(project.cost_budget_minor),
    })),
    invoices: snapshots.invoices,
    costs: snapshots.costs,
  });
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: org.name }, { href: "/app/reports", label: "Reports" }, { label: "Budget" }]} title="Budget versus actual" />
      <form className="row-actions">
        <label className="field">From<input type="date" name="from" defaultValue={from} /></label>
        <label className="field">To<input type="date" name="to" defaultValue={to} /></label>
        <button className="btn" type="submit">Apply</button>
      </form>
      <div className="table-wrap panel">
        <table>
          <caption className="muted">Budgets are omitted when unset. Zero means a recorded zero, not a missing budget.</caption>
          <thead><tr><th>Project</th><th className="num">Revenue budget</th><th className="num">Recognized</th><th className="num">Cost budget</th><th className="num">Delivery cost</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.projectId}>
                <td><Link href={`/app/projects/${row.projectId}`}>{row.projectName}</Link></td>
                <td className="num">{row.revenueBudgetMinor == null ? "Not set" : <Money minor={row.revenueBudgetMinor} currency={org.currency} />}</td>
                <td className="num"><Money minor={row.recognizedMinor} currency={org.currency} /></td>
                <td className="num">{row.costBudgetMinor == null ? "Not set" : <Money minor={row.costBudgetMinor} currency={org.currency} />}</td>
                <td className="num"><Money minor={row.costMinor} currency={org.currency} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
