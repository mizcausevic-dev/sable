import { ActionForm } from "@/components/interactive";
import { Denied, Money, PageHeader } from "@/components/ui";
import { formatMinutes } from "@/lib/time";
import { can } from "@/lib/permissions";
import { rateAction, timeAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { asMinor, asText, loadTime } from "@/server/load";
import { todayInTimeZone } from "@/lib/time";

export default async function TimePage() {
  const { user, org } = await requireOrg();
  if (!can(org.role, "time.write") && !can(org.role, "finance.internal")) return <Denied what="view time" />;
  const data = await loadTime(user.id, org.organizationId);
  const internal = can(org.role, "finance.internal");
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: org.name }, { label: "Time" }]} title="Time" />
      <div className="table-wrap panel">
        <table>
          <caption className="muted">Time entries</caption>
          <thead><tr><th>Date</th><th>Person</th><th>Project</th><th className="num">Time</th>{internal ? <th className="num">Cost</th> : null}</tr></thead>
          <tbody>
            {data.entries.map((entry) => (
              <tr key={asText(entry.id)}>
                <td className="num">{asText(entry.work_date)}</td>
                <td>{asText(entry.user_name)}</td>
                <td>{asText(entry.project_name)}</td>
                <td className="num">{formatMinutes(asMinor(entry.minutes))}</td>
                {internal ? <td className="num">{entry.cost_amount_minor == null ? "No rate" : <Money minor={asMinor(entry.cost_amount_minor)} currency={org.currency} />}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="panel">
        <h2>Record time</h2>
        <ActionForm action={timeAction} submit="Save time">
          <label className="field">Project<select name="projectId">{data.projects.map((project) => <option key={asText(project.id)} value={asText(project.id)}>{asText(project.name)}</option>)}</select></label>
          <label className="field">Person
            <select name="userId" defaultValue={user.id}>
              {(org.role === "contributor" ? data.staff.filter((person) => asText(person.id) === user.id) : data.staff).map((person) => (
                <option key={asText(person.id)} value={asText(person.id)}>{asText(person.name)}</option>
              ))}
            </select>
          </label>
          <label className="field">Work date<input name="workDate" type="date" defaultValue={todayInTimeZone(org.timezone)} required /></label>
          <label className="field">Minutes<input name="minutes" type="number" min={1} max={1440} required /></label>
          <label className="field">Note<input name="note" /></label>
          <label><input type="checkbox" name="billable" defaultChecked /> Billable</label>
        </ActionForm>
      </section>
      {internal ? (
        <section className="panel">
          <h2>Internal cost rates</h2>
          <ul>{data.rates.map((rate) => <li key={`${asText(rate.user_id)}-${asText(rate.effective_on)}`}>{asText(rate.name)} · <Money minor={asMinor(rate.hourly_rate_minor)} currency={org.currency} /> / hour from {asText(rate.effective_on)}</li>)}</ul>
          <ActionForm action={rateAction} submit="Save rate">
            <label className="field">Person<select name="userId">{data.staff.map((person) => <option key={asText(person.id)} value={asText(person.id)}>{asText(person.name)}</option>)}</select></label>
            <label className="field">Hourly rate<input name="hourly" placeholder="85.00" required /></label>
            <label className="field">Effective on<input name="effectiveOn" type="date" required /></label>
          </ActionForm>
        </section>
      ) : <p className="muted">Internal cost rates are hidden for this role.</p>}
    </>
  );
}
