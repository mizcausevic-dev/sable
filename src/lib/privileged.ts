/**
 * Connection-level bypasses of row level security.
 * The database role for these calls is the migration owner, which is a superuser on
 * local PGlite and the Supabase postgres role in production. Both bypass RLS.
 * Every other request sets the app_user role and is subject to policies.
 */
export const PRIVILEGED_REASONS = [
  "migrate",
  "seed",
  "register-user",
  "login-lookup",
  "supabase-user-link",
  "invitation-preview",
] as const;

export type PrivilegedReason = (typeof PRIVILEGED_REASONS)[number];

export const PRIVILEGED_FUNCTIONS = [
  "private.register_user",
  "private.register_user_with_id",
  "private.lookup_login",
  "private.create_organization",
  "private.accept_invitation",
  "private.revoke_invitation",
  "private.set_member_role",
  "private.remove_member",
  "private.notify",
  "private.write_audit",
  "private.within_storage_limit",
] as const;
