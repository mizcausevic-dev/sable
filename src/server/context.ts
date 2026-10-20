import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { bootDatabase, withUser } from "@/lib/db";
import { can, isRole, type Permission, type Role } from "@/lib/permissions";
import { ORG_COOKIE, SESSION_COOKIE, openSession } from "@/lib/tokens";

export type SessionUser = { id: string; email: string; name: string };
export type OrgContext = {
  organizationId: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  role: Role;
};

export async function currentUser(): Promise<SessionUser | null> {
  await bootDatabase();
  const jar = await cookies();
  const claims = openSession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const rows = await withUser(claims.sub, (db) =>
    db.query<{ id: string; email: string; name: string }>(
      `select id, email, name from users where id = $1`,
      [claims.sub],
    ),
  );
  return rows[0] ?? null;
}

export async function listMemberships(userId: string): Promise<OrgContext[]> {
  const rows = await withUser(userId, (db) =>
    db.query(
      `select o.id, o.name, o.slug, o.currency, o.timezone, m.role
       from memberships m
       join organizations o on o.id = m.organization_id
       where m.user_id = $1
       order by o.name`,
      [userId],
    ),
  );
  return rows.flatMap((row) => {
    const role = String(row.role);
    if (!isRole(role)) return [];
    return [{
      organizationId: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      currency: String(row.currency),
      timezone: String(row.timezone),
      role,
    }];
  });
}

export async function optionalOrg(): Promise<{ user: SessionUser; org: OrgContext; memberships: OrgContext[] } | null> {
  const user = await currentUser();
  if (!user) return null;
  const memberships = await listMemberships(user.id);
  if (memberships.length === 0) return null;
  const jar = await cookies();
  const requested = jar.get(ORG_COOKIE)?.value;
  const org = memberships.find((membership) => membership.organizationId === requested) ?? memberships[0];
  return { user, org, memberships };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireOrg(): Promise<{ user: SessionUser; org: OrgContext; memberships: OrgContext[] }> {
  const user = await requireUser();
  const memberships = await listMemberships(user.id);
  if (memberships.length === 0) redirect("/onboarding");
  const jar = await cookies();
  const requested = jar.get(ORG_COOKIE)?.value;
  const org = memberships.find((membership) => membership.organizationId === requested) ?? memberships[0];
  return { user, org, memberships };
}

export function allows(role: Role, permission: Permission): boolean {
  return can(role, permission);
}
