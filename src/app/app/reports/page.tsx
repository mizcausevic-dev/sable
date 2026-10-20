import Link from "next/link";
import { Denied, Empty, Money, PageHeader } from "@/components/ui";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { financialReport } from "@/lib/reports";
import { todayInTimeZone } from "@/lib/time";
import { requireOrg } from "@/server/context";
import { loadFinancialSnapshots } from "@/server/sql";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { user, org } = await requireOrg();
  if (!can(org.role, "reports.financial")) return <Denied what="read financial reports" />;
  const today = todayInTimeZone(org.timezone);
  const query = await searchParams;
  const from = query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : `${today.slice(0, 7)}-01`;
  const to = query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? query.to : today;
  const snapshots = await withUser(user.id, (db) => loadFinancialSnapshots(db, org.organizationId));
  const report = financialReport({ from, to, ...snapshots });
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: org.name }, { label: "Reports" }]} title="Revenue report" />
      <form className="row-actions">
        <label className="field">From<input name="from" type="date" defaultValue={from} /></label>
        <label className="field">To<input name="to" type="date" defaultValue={to} /></label>
        <button className="btn" type="submit">Apply</button>
        {can(org.role, "reports.export") ? <a className="btn" href={`/api/reports/export?from=${from}&to=${to}`}>Export CSV</a> : null}
      </form>
      <p className="muted">Recognized revenue sums issued, partial, and paid invoice totals whose issued date is in range. Outstanding is the current balance of the issued and partial invoices in that set. Collected sums payments received in range, split into manual and provider-confirmed. Gross profit is recognized revenue minus delivery cost from time in range. Margin is omitted when recognized revenue is zero.</p>
      {report.empty ? <Empty title="No records in this range" body="The totals are not shown because there are no invoices, payments, or delivery costs to add up." /> : (
        <>
          <section className="grid-3">
            <article className="panel stat"><span className="muted">Recognized</span><b><Money minor={report.recognizedMinor} currency={org.currency} /></b></article>
            <article className="panel stat"><span className="muted">Outstanding</span><b><Money minor={report.outstandingMinor} currency={org.currency} /></b></article>
            <article className="panel stat"><span className="muted">Collected</span><b><Money minor={report.collectedMinor} currency={org.currency} /></b><span className="muted">Manual <Money minor={report.manualCollectedMinor} currency={org.currency} /> · Provider <Money minor={report.providerCollectedMinor} currency={org.currency} /></span></article>
            <article className="panel stat"><span className="muted">Delivery cost</span><b><Money minor={report.costMinor} currency={org.currency} /></b></article>
            <article className="panel stat"><span className="muted">Gross profit</span><b><Money minor={report.grossProfitMinor} currency={org.currency} /></b></article>
            <article className="panel stat"><span className="muted">Margin</span><b className="num">{report.marginBps == null ? "n/a" : `${(report.marginBps / 100).toFixed(2)}%`}</b></article>
          </section>
          <div className="table-wrap panel">
            <table>
              <caption className="muted">Invoices in range</caption>
              <thead><tr><th>Invoice</th><th>Status</th><th className="num">Total</th><th className="num">Paid</th></tr></thead>
              <tbody>
                {report.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td><Link href={`/app/revenue/invoices/${invoice.id}`}>{invoice.number}</Link></td>
                    <td>{invoice.status}</td>
                    <td className="num"><Money minor={invoice.totalMinor} currency={org.currency} /></td>
                    <td className="num"><Money minor={invoice.paidMinor} currency={org.currency} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
