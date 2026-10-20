import { ActionForm, ConfirmSubmit } from "@/components/interactive";
import { Badge, Denied, PageHeader } from "@/components/ui";
import { formatTimestamp } from "@/lib/time";
import { can, inviteRolesFor, ROLES } from "@/lib/permissions";
import { inviteAction, removeMemberAction, revokeInviteAction, setRoleAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { asText, loadMembers } from "@/server/load";

function invitationState(row: Record<string, unknown>): string {
  if (row.revoked_at) return "revoked";
  if (row.accepted_at) return "accepted";
  if (row.expires_at && new Date(String(row.expires_at)).getTime() < Date.now()) return "expired";
  return "open";
}

export default async function MembersPage() {
  const { user, org } = await requireOrg();
  if (!can(org.role, "org.invite") && !can(org.role, "org.members")) return <Denied what="manage members" />;
  const data = await loadMembers(user.id, org.organizationId);
  const inviteRoles = inviteRolesFor(org.role);
  const manage = can(org.role, "org.members");
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: org.name }, { href: "/app/settings", label: "Settings" }, { label: "Members" }]} title="Members" />
      <div className="table-wrap panel">
        <table>
          <caption className="muted">People in this organization</caption>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th>{manage ? <th>Change</th> : null}</tr></thead>
          <tbody>
            {data.members.map((member) => (
              <tr key={asText(member.id)}>
                <td>{asText(member.name)}</td>
                <td>{asText(member.email)}</td>
                <td><Badge>{asText(member.role)}</Badge></td>
                {manage ? (
                  <td>
                    <form action={setRoleAction} className="row-actions">
                      <input type="hidden" name="userId" value={asText(member.id)} />
                      <select name="role" defaultValue={asText(member.role)} aria-label={`Role for ${asText(member.name)}`}>
                        {(org.role === "owner" ? ROLES : ROLES.filter((role) => role !== "owner")).map((role) => (
                          <option key={role}>{role}</option>
                        ))}
                      </select>
                      <button className="btn" type="submit">Save role</button>
                    </form>
                    {asText(member.id) === user.id ? null : (
                      <ConfirmSubmit
                        label="Remove"
                        title={`Remove ${asText(member.name)}?`}
                        confirm="Remove member"
                        action={removeMemberAction}
                        fields={{ userId: asText(member.id) }}
                      />
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">The last owner cannot be demoted or removed. Admins cannot grant or remove the owner role.</p>
      {can(org.role, "org.invite") ? (
        <section className="panel">
          <h2>Invite</h2>
          <p className="muted">The invitation link is shown after you submit. Email delivery is not implemented. Links expire after 7 days and can be revoked before acceptance.</p>
          <ActionForm action={inviteAction} submit="Create invitation">
            <label className="field">Email<input name="email" type="email" required /></label>
            <label className="field">Role
              <select name="role">{inviteRoles.map((role) => <option key={role}>{role}</option>)}</select>
            </label>
          </ActionForm>
        </section>
      ) : null}
      <section className="panel">
        <h2>Invitations</h2>
        {data.invitations.length === 0 ? <p className="muted">No invitations.</p> : (
          <ul>
            {data.invitations.map((invite) => {
              const state = invitationState(invite);
              return (
                <li key={asText(invite.id)}>
                  {asText(invite.email)} · {asText(invite.role)} · <Badge>{state}</Badge>
                  <span className="muted"> · expires {formatTimestamp(String(invite.expires_at), org.timezone)}</span>
                  {state === "open" && can(org.role, "org.invite") ? (
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="invitationId" value={asText(invite.id)} />
                      <button className="btn" type="submit">Revoke</button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
