import { PageHeader } from "@/components/ui";
import { NOTIFICATION_CHANNELS, NOTIFICATION_KINDS } from "@/lib/notifications";
import { preferenceAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { asText, loadPreferences } from "@/server/load";

export default async function NotificationSettingsPage() {
  const { user, org } = await requireOrg();
  const saved = await loadPreferences(user.id, org.organizationId);
  const byKind = new Map(saved.map((row) => [asText(row.kind), row]));
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: org.name }, { href: "/app/settings", label: "Settings" }, { label: "Notifications" }]} title="Notification preferences" />
      <p className="muted">
        In-app: {NOTIFICATION_CHANNELS.inApp}. Email: {NOTIFICATION_CHANNELS.email}. Push: {NOTIFICATION_CHANNELS.push}.
        Turning in-app off stops new rows for that kind. Existing rows stay in the inbox.
      </p>
      {NOTIFICATION_KINDS.map((kind) => {
        const row = byKind.get(kind);
        return (
          <form key={kind} action={preferenceAction} className="panel row-actions">
            <input type="hidden" name="kind" value={kind} />
            <strong>{kind}</strong>
            <label><input type="checkbox" name="inApp" defaultChecked={row ? Boolean(row.in_app) : true} /> In-app</label>
            <label><input type="checkbox" name="email" defaultChecked={Boolean(row?.email)} /> Email (not sent)</label>
            <label><input type="checkbox" name="push" defaultChecked={Boolean(row?.push)} /> Push (not sent)</label>
            <button className="btn" type="submit">Save</button>
          </form>
        );
      })}
    </>
  );
}
