import { Denied, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireOrg } from "@/server/context";
import { asMinor, asText, loadSubscription } from "@/server/load";

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default async function BillingPage() {
  const { user, org } = await requireOrg();
  if (!can(org.role, "org.billing")) return <Denied what="read billing" />;
  const rows = await loadSubscription(user.id, org.organizationId);
  const plan = rows[0];
  const provider = process.env.PAYMENT_PROVIDER;
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: org.name }, { href: "/app/settings", label: "Settings" }, { label: "Billing" }]} title="Subscription" />
      {!provider || asText(plan?.provider) === "mock" ? (
        <div className="banner mock">
          <strong>Mock billing adapter.</strong>
          <p>No payment provider is charging this organization. Plan, status, and limits below are application records. They do not create invoices at a processor{provider ? "" : ", because PAYMENT_PROVIDER is unset"}.</p>
        </div>
      ) : (
        <p className="muted">Provider name on record: {provider}. This screen still does not start a checkout.</p>
      )}
      {plan ? (
        <section className="grid-3">
          <article className="panel stat"><span className="muted">Plan</span><b>{asText(plan.plan)}</b><span className="muted">{asText(plan.status)} · {asText(plan.provider)}</span></article>
          <article className="panel stat"><span className="muted">Seats</span><b className="num">{asMinor(plan.seats)} / {asMinor(plan.seat_limit)}</b></article>
          <article className="panel stat"><span className="muted">Projects</span><b className="num">{asMinor(plan.projects)} / {asMinor(plan.project_limit)}</b></article>
          <article className="panel stat"><span className="muted">Storage</span><b className="num">{bytes(asMinor(plan.bytes))} / {bytes(asMinor(plan.storage_limit_bytes))}</b></article>
        </section>
      ) : <p className="muted">No subscription row is visible for this organization.</p>}
    </>
  );
}
