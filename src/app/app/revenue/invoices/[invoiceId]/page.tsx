import { notFound } from "next/navigation";
import { ActionForm, ConfirmSubmit } from "@/components/interactive";
import { Badge, Denied, Money, PageHeader } from "@/components/ui";
import { formatQuantity } from "@/lib/money";
import { can } from "@/lib/permissions";
import { paymentAction, transitionAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { asMinor, asText, loadInvoice } from "@/server/load";
import { todayInTimeZone } from "@/lib/time";

export default async function InvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { user, org } = await requireOrg();
  if (!can(org.role, "finance.read") && org.role !== "client") return <Denied what="read invoices" />;
  const { invoiceId } = await params;
  const bundle = await loadInvoice(user.id, org.organizationId, invoiceId);
  if (!bundle) notFound();
  const invoice = bundle.invoice;
  const total = bundle.lines.reduce((sum, line) => sum + asMinor(line.total_minor), 0);
  const paid = bundle.payments.reduce((sum, payment) => sum + asMinor(payment.amount_minor), 0);
  const balance = total - paid;
  const provider = process.env.PAYMENT_PROVIDER;
  const write = can(org.role, "finance.write");
  return (
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: org.name }, { href: "/app/revenue", label: "Revenue" }, { label: asText(invoice.number) }]}
        title={`${asText(invoice.number)} · ${asText(invoice.title)}`}
        actions={<Badge>{asText(invoice.status)}</Badge>}
      />
      <p className="muted">{asText(invoice.client_name)} · issued {asText(invoice.issued_on) || "not issued"} · due {asText(invoice.due_on) || "unset"}</p>
      <section className="grid-3">
        <article className="panel stat"><span className="muted">Total</span><b><Money minor={total} currency={org.currency} /></b></article>
        <article className="panel stat"><span className="muted">Paid</span><b><Money minor={paid} currency={org.currency} /></b></article>
        <article className="panel stat"><span className="muted">Balance</span><b><Money minor={balance} currency={org.currency} /></b></article>
      </section>
      <div className="table-wrap panel">
        <table>
          <caption className="muted">Line items</caption>
          <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Total</th></tr></thead>
          <tbody>
            {bundle.lines.map((line) => (
              <tr key={asText(line.description) + asText(line.total_minor)}>
                <td>{asText(line.description)}</td>
                <td className="num">{formatQuantity(asMinor(line.quantity_milli))}</td>
                <td className="num"><Money minor={asMinor(line.unit_amount_minor)} currency={org.currency} /></td>
                <td className="num"><Money minor={asMinor(line.total_minor)} currency={org.currency} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="panel">
        <h2>Payments</h2>
        {bundle.payments.length === 0 ? <p className="muted">No payments recorded.</p> : (
          <ul>
            {bundle.payments.map((payment) => (
              <li key={asText(payment.id)}>
                <Money minor={asMinor(payment.amount_minor)} currency={org.currency} /> · {asText(payment.source)}
                {payment.source === "provider" ? ` · ${asText(payment.provider)} ${asText(payment.provider_reference)}` : " · recorded by the agency, not confirmed by a provider"}
                · {asText(payment.received_on)}
              </li>
            ))}
          </ul>
        )}
      </section>
      {write && asText(invoice.status) === "draft" ? (
        <form action={transitionAction} className="panel form-grid">
          <input type="hidden" name="kind" value="invoice" />
          <input type="hidden" name="id" value={invoiceId} />
          <input type="hidden" name="current" value="draft" />
          <input type="hidden" name="status" value="issued" />
          <label className="field">Issued on<input name="issuedOn" type="date" defaultValue={todayInTimeZone(org.timezone)} required /></label>
          <label className="field">Due on<input name="dueOn" type="date" /></label>
          <button className="btn primary" type="submit">Issue invoice</button>
        </form>
      ) : null}
      {write && (asText(invoice.status) === "issued" || asText(invoice.status) === "partial") ? (
        <section className="panel">
          <h2>Record a manual payment</h2>
          <ActionForm action={paymentAction} submit="Record manual payment">
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <input type="hidden" name="source" value="manual" />
            <label className="field">Amount<input name="amount" required /></label>
            <label className="field">Received on<input name="receivedOn" type="date" defaultValue={todayInTimeZone(org.timezone)} required /></label>
          </ActionForm>
          <h2>Provider-confirmed payment</h2>
          {provider ? (
            <ActionForm action={paymentAction} submit="Record provider payment">
              <input type="hidden" name="invoiceId" value={invoiceId} />
              <input type="hidden" name="source" value="provider" />
              <label className="field">Amount<input name="amount" required /></label>
              <label className="field">Received on<input name="receivedOn" type="date" required /></label>
              <label className="field">Provider<input name="provider" defaultValue={provider} required /></label>
              <label className="field">Provider reference<input name="providerReference" required /></label>
            </ActionForm>
          ) : (
            <div className="banner mock">
              <strong>No payment provider is configured.</strong>
              <p>Provider-confirmed payments stay unavailable. A manual payment is a ledger entry, not a charge.</p>
            </div>
          )}
          <ConfirmSubmit
            label="Void invoice"
            title="Void this invoice?"
            confirm="Void invoice"
            action={async (formData) => {
              "use server";
              const { transitionAction: transition } = await import("@/server/actions/work");
              formData.set("kind", "invoice");
              formData.set("id", invoiceId);
              formData.set("current", asText(invoice.status));
              formData.set("status", "void");
              await transition(formData);
            }}
            fields={{}}
          />
        </section>
      ) : null}
    </>
  );
}
