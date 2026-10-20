import { ActionForm } from "@/components/interactive";
import { withService } from "@/lib/db";
import { hashToken } from "@/lib/tokens";
import { acceptInvitationAction } from "@/server/actions/auth";
import { currentUser } from "@/server/context";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rows = await withService("invitation-preview", (db) =>
    db.query(
      `select i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, o.name as organization
       from invitations i join organizations o on o.id = i.organization_id
       where i.token_hash = $1`,
      [hashToken(token)],
    ),
  );
  const invite = rows[0];
  const user = await currentUser();
  if (!invite) return <main className="auth" id="content"><h1>Invitation not found</h1></main>;
  const expired = new Date(String(invite.expires_at)).getTime() <= Date.now();
  return (
    <main className="auth" id="content">
      <h1>Join {String(invite.organization)}</h1>
      <p>Role: {String(invite.role)}. Sent to {String(invite.email)}.</p>
      {invite.revoked_at ? <p role="alert">This invitation was revoked.</p> : null}
      {invite.accepted_at ? <p>This invitation was already accepted.</p> : null}
      {expired ? <p role="alert">This invitation has expired.</p> : null}
      {!invite.revoked_at && !invite.accepted_at && !expired ? (
        <ActionForm action={acceptInvitationAction} submit="Accept invitation">
          <input type="hidden" name="token" value={token} />
          {user ? <p>Signed in as {user.email}.</p> : (
            <>
              <label className="field">Name<input name="name" required /></label>
              <label className="field">Password<input name="password" type="password" minLength={10} required /></label>
            </>
          )}
        </ActionForm>
      ) : null}
      <p className="muted">Invitation links are shown to the inviter. Email delivery is not implemented.</p>
    </main>
  );
}
