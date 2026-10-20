import { PageHeader } from "@/components/ui";
import { formatTimestamp } from "@/lib/time";
import { readNotificationAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { asText, loadNotifications } from "@/server/load";

export default async function NotificationsPage() {
  const { user, org } = await requireOrg();
  const rows = await loadNotifications(user.id);
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: org.name }, { label: "Inbox" }]} title="Inbox" />
      <p className="muted">In-app delivery is implemented. Email and push preferences are stored and are not sent.</p>
      {rows.length === 0 ? <p className="muted">No notifications.</p> : (
        <ul className="stack">
          {rows.map((row) => (
            <li key={asText(row.id)} className="panel">
              <strong>{asText(row.title)}</strong>
              {row.read_at ? <span className="muted"> · Read</span> : <span className="muted"> · Unread</span>}
              <p>{asText(row.body)}</p>
              <p className="muted">{formatTimestamp(String(row.created_at), org.timezone)} · {asText(row.kind)}</p>
              <div className="row-actions">
                {row.href ? <a href={asText(row.href)}>Open</a> : null}
                {row.read_at ? null : (
                  <form action={readNotificationAction}>
                    <input type="hidden" name="id" value={asText(row.id)} />
                    <button className="btn" type="submit">Mark read</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
