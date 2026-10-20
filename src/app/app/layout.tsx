import Link from "next/link";
import { CommandPalette, Shell, ThemeControls } from "@/components/interactive";
import { can, type Permission } from "@/lib/permissions";
import { logoutAction } from "@/server/actions/auth";
import { switchOrgAction } from "@/server/actions/work";
import { requireOrg } from "@/server/context";
import { unreadCount } from "@/server/load";

const NAV: { href: string; label: string; permission?: Permission }[] = [
  { href: "/app", label: "Home" },
  { href: "/app/clients", label: "Clients", permission: "clients.read" },
  { href: "/app/projects", label: "Projects", permission: "projects.read" },
  { href: "/app/revenue", label: "Revenue", permission: "finance.read" },
  { href: "/app/time", label: "Time", permission: "time.write" },
  { href: "/app/reports", label: "Reports", permission: "reports.financial" },
  { href: "/app/reports/workload", label: "Workload", permission: "reports.operational" },
  { href: "/app/settings", label: "Settings" },
];

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, org, memberships } = await requireOrg();
  const unread = await unreadCount(user.id);
  const links = NAV.filter((item) => !item.permission || can(org.role, item.permission));
  return (
    <Shell
      brand={<span>Sable<small>{org.name}</small></span>}
      links={links}
      tools={
        <>
          <CommandPalette orgId={org.organizationId} />
          <form action={switchOrgAction} className="row-actions">
            <label className="field">
              Organization
              <select name="organizationId" defaultValue={org.organizationId} aria-label="Organization">
                {memberships.map((membership) => (
                  <option key={membership.organizationId} value={membership.organizationId}>
                    {membership.name} ({membership.role})
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" type="submit">Switch</button>
          </form>
          <Link href="/app/notifications">Inbox {unread > 0 ? `(${unread})` : ""}</Link>
          <span className="muted">{user.name} · {org.role}</span>
          <form action={logoutAction}><button className="btn" type="submit">Sign out</button></form>
          <ThemeControls />
        </>
      }
    >
      {children}
    </Shell>
  );
}
