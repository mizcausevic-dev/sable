import Link from "next/link";
import { Badge, Denied, Empty, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireOrg } from "@/server/context";
import { asText, loadClients } from "@/server/load";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { user, org } = await requireOrg();
  if (!can(org.role, "clients.read")) return <Denied what="read clients" />;
  const { q = "" } = await searchParams;
  const clients = await loadClients(user.id, org.organizationId, q);
  return (
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: org.name }, { label: "Clients" }]}
        title="Clients"
        actions={can(org.role, "clients.write") ? <Link className="btn primary" href="/app/clients/new">New client</Link> : null}
      />
      <form className="row-actions">
        <label className="field">Search<input name="q" defaultValue={q} placeholder="Name" /></label>
        <button className="btn" type="submit">Search</button>
      </form>
      {clients.length === 0 ? (
        <Empty title={q ? "No clients match" : "No clients yet"} body={q ? "Try a different name." : "Add a client before opening a project."} href="/app/clients/new" action={can(org.role, "clients.write") ? "New client" : undefined} />
      ) : (
        <div className="table-wrap panel">
          <table>
            <caption className="muted">Client directory</caption>
            <thead><tr><th>Name</th><th>Stage</th><th>Website</th></tr></thead>
            <tbody>
              {clients.map((client) => (
                <tr key={asText(client.id)}>
                  <td><Link href={`/app/clients/${asText(client.id)}`}>{asText(client.name)}</Link></td>
                  <td><Badge>{asText(client.stage)}</Badge></td>
                  <td className="muted">{asText(client.website)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
