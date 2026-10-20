export const ROLES = ["owner", "admin", "manager", "contributor", "client"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "org.settings",
  "org.billing",
  "org.members",
  "org.invite",
  "org.audit",
  "clients.read",
  "clients.write",
  "projects.read",
  "projects.write",
  "tasks.write",
  "tasks.assign",
  "templates.manage",
  "finance.read",
  "finance.write",
  "finance.internal",
  "time.write",
  "reports.operational",
  "reports.financial",
  "reports.export",
  "files.write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Explicit matrix. Database policies are the read authority. Actions check this before they write. */
const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  // Admins hold every permission. Ownership changes are refused in private.set_member_role.
  admin: new Set(PERMISSIONS),
  manager: new Set<Permission>([
    "org.invite",
    "clients.read",
    "clients.write",
    "projects.read",
    "projects.write",
    "tasks.write",
    "tasks.assign",
    "templates.manage",
    "finance.read",
    "finance.write",
    "finance.internal",
    "time.write",
    "reports.operational",
    "reports.financial",
    "reports.export",
    "files.write",
  ]),
  contributor: new Set<Permission>([
    "clients.read",
    "clients.write",
    "projects.read",
    "projects.write",
    "tasks.write",
    "time.write",
    "reports.operational",
    "files.write",
  ]),
  client: new Set<Permission>(["clients.read", "projects.read"]),
};

// Admin matches owner except they cannot grant or remove the owner role. That exception is
// enforced in private.set_member_role, not as a missing permission, because admins still
// manage every other member and the billing screen.
MATRIX.admin = new Set(PERMISSIONS);

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return PERMISSIONS.filter((permission) => MATRIX[role].has(permission));
}

export function inviteRolesFor(role: Role): Role[] {
  if (role === "owner") return [...ROLES];
  if (role === "admin") return ["admin", "manager", "contributor", "client"];
  if (role === "manager") return ["contributor", "client"];
  return [];
}
