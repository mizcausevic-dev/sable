import { Denied, Empty, PageHeader } from "@/components/ui";
import { formatMinutes } from "@/lib/time";
import { can } from "@/lib/permissions";
import { availabilityAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { asMinor, asText, loadWorkload } from "@/server/load";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function WorkloadPage() {
  const { user, org } = await requireOrg();
  if (!can(org.role, "reports.operational")) return <Denied what="read workload" />;
  const selfOnly = !can(org.role, "reports.financial");
  const rows = await loadWorkload(user.id, org.organizationId, selfOnly);
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: org.name }, { label: "Workload" }]} title="Workload and capacity" />
      <p className="muted">Open tasks are assignments that are not done. Weekly availability is the sum of configured weekday minutes. Missing configuration is not treated as 40 hours.</p>
<p><a className="btn" href="/api/reports/workload">Export CSV</a></p>
      {rows.length === 0 ? <Empty title="No staff in view" body="Workload appears after a staff member joins the organization." /> : (
        <div className="table-wrap panel">
          <table>
            <caption className="muted">Capacity</caption>
            <thead><tr><th>Person</th><th className="num">Open tasks</th><th>Weekly availability</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={asText(row.id)}>
                  <td>{asText(row.name)}</td>
                  <td className="num">{asMinor(row.open_tasks)}</td>
                  <td>{asMinor(row.windows) === 0 ? "Not configured" : formatMinutes(asMinor(row.minutes))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="panel">
        <h2>Set your availability</h2>
        <form action={availabilityAction} className="row-actions">
          <input type="hidden" name="userId" value={user.id} />
          <label className="field">Weekday<select name="weekday">{DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
          <label className="field">Minutes<input name="minutes" type="number" min={0} max={1440} defaultValue={480} /></label>
          <button className="btn" type="submit">Save day</button>
        </form>
      </section>
    </>
  );
}
