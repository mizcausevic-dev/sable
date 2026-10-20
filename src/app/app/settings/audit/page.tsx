import { Denied, Empty, PageHeader } from "@/components/ui";
import { formatTimestamp } from "@/lib/time";
import { can } from "@/lib/permissions";
import { requireOrg } from "@/server/context";
import { asText, loadAudit } from "@/server/load";

export default async function AuditPage() {
  const { user, org } = await requireOrg();
  if (!can(org.role, "org.audit")) return <Denied what="read the audit log" />;
  const rows = await loadAudit(user.id, org.organizationId);
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: org.name }, { href: "/app/settings", label: "Settings" }, { label: "Audit" }]} title="Audit" />
      <p className="muted">Application audit rows are append-only. Owners and admins can read them. Ordinary requests cannot insert or update this table. Privileged database functions write the rows.</p>
      {rows.length === 0 ? <Empty title="No audit events" body="Events appear after organization changes that write through the audit function." /> : (
        <div className="table-wrap panel">
          <table>
            <caption className="muted">Latest 100 events</caption>
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Record</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${asText(row.created_at)}-${asText(row.action)}-${asText(row.entity_id)}`}>
                  <td className="num">{formatTimestamp(String(row.created_at), org.timezone)}</td>
                  <td>{asText(row.actor) || "System"}</td>
                  <td>{asText(row.action)}</td>
                  <td>{asText(row.entity_type)} {asText(row.entity_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
