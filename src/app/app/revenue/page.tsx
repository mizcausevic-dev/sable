import Link from "next/link";
import { ActionForm } from "@/components/interactive";
import { Badge, Denied, Money, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { createDocumentAction, transitionAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { asMinor, asText, loadRevenue } from "@/server/load";

export default async function RevenuePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { user, org } = await requireOrg();
  if (!can(org.role, "finance.read")) return <Denied what="read revenue" />;
  const kind = (await searchParams).kind ?? "invoice";
  const data = await loadRevenue(user.id, org.organizationId);
  const write = can(org.role, "finance.write");
  return (
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: org.name }, { label: "Revenue" }]}
        title="Revenue"
        actions={
          <>
            <Link className="btn" href="?kind=estimate">Estimates</Link>
            <Link className="btn" href="?kind=proposal">Proposals</Link>
            <Link className="btn" href="?kind=invoice">Invoices</Link>
          </>
        }
      />
      <div className="table-wrap panel">
        <table>
          <caption className="muted">{kind}s</caption>
          <thead><tr><th>Number</th><th>Title</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th></tr></thead>
          <tbody>
            {(kind === "estimate" ? data.estimates : kind === "proposal" ? data.proposals : data.invoices).map((row) => {
              const total = "total_minor" in row ? asMinor(row.total_minor) : null;
              const paid = "paid_minor" in row ? asMinor(row.paid_minor) : null;
              return (
                <tr key={asText(row.id)}>
                  <td>{kind === "invoice" ? <Link href={`/app/revenue/invoices/${asText(row.id)}`}>{asText(row.number)}</Link> : asText(row.number)}</td>
                  <td>{asText(row.title)}</td>
                  <td><Badge>{asText(row.status)}</Badge></td>
                  <td className="num">{total == null ? "—" : <Money minor={total} currency={org.currency} />}</td>
                  <td className="num">{total == null || paid == null ? "" : <Money minor={total - paid} currency={org.currency} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {write ? (
        <section className="panel">
          <h2>New {kind}</h2>
          <ActionForm action={createDocumentAction} submit={`Create ${kind}`}>
            <input type="hidden" name="kind" value={kind} />
            <label className="field">Client<select name="clientId">{data.clients.map((client) => <option key={asText(client.id)} value={asText(client.id)}>{asText(client.name)}</option>)}</select></label>
            <label className="field">Project
              <select name="projectId"><option value="">None</option>{data.projects.map((project) => <option key={asText(project.id)} value={asText(project.id)}>{asText(project.name)}</option>)}</select>
            </label>
            <label className="field">Title<input name="title" required /></label>
            <label className="field">Line description<input name="description" required /></label>
            <label className="field">Quantity<input name="quantity" defaultValue="1" required /></label>
            <label className="field">Unit amount<input name="unitAmount" placeholder="0.00" required /></label>
          </ActionForm>
          <p className="muted">Amounts are stored in minor units. Quantity supports up to 3 decimal places and is converted to thousandths.</p>
        </section>
      ) : null}
      {write && kind !== "invoice" ? (
        <section className="panel">
          <h2>Move a {kind}</h2>
          <form action={transitionAction} className="form-grid">
            <input type="hidden" name="kind" value={kind} />
            <label className="field">Record
              <select name="id">{(kind === "estimate" ? data.estimates : data.proposals).map((row) => <option key={asText(row.id)} value={asText(row.id)}>{asText(row.number)} ({asText(row.status)})</option>)}</select>
            </label>
            <label className="field">Current status<input name="current" placeholder="draft" required /></label>
            <label className="field">Next status
              <select name="status">{["sent", "accepted", "declined", "withdrawn", "expired"].map((status) => <option key={status}>{status}</option>)}</select>
            </label>
            <button className="btn" type="submit">Transition</button>
          </form>
        </section>
      ) : null}
    </>
  );
}
