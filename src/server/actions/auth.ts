"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UserError, idleState, runAction, type ActionState } from "@/lib/action";
import { withService, withUser } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { ORG_COOKIE, SESSION_COOKIE, hashToken, sealSession } from "@/lib/tokens";
import { fieldError, loginSchema, organizationSchema, signupSchema } from "@/lib/validation";
import { currentUser, requireUser } from "../context";
import { linkSupabaseUser, supabaseConfigured, verifySupabasePassword, signUpSupabase } from "@/lib/supabase/auth";

const attempts = new Map<string, { count: number; reset: number }>();

function limited(key: string): boolean {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.reset < now) {
    attempts.set(key, { count: 1, reset: now + 10 * 60 * 1000 });
    return false;
  }
  current.count += 1;
  return current.count > 8;
}

async function startSession(userId: string, orgId?: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sealSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 12,
  });
  if (orgId) {
    jar.set(ORG_COOKIE, orgId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}

export async function loginAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  if (limited(parsed.data.email)) return { ok: false, error: "Too many sign-in attempts. Wait a few minutes." };

  if (supabaseConfigured()) {
    const remote = await verifySupabasePassword(parsed.data.email, parsed.data.password);
    if (!remote) return { ok: false, error: "Email or password is incorrect." };
    const local = await withService("login-lookup", (db) =>
      db.query<{ id: string }>(`select id from users where id = $1`, [remote.id]),
    );
    if (!local[0]) return { ok: false, error: "This Supabase user is not linked to a Sable profile." };
    await startSession(local[0].id);
    redirect("/app");
  }

  const rows = await withService("login-lookup", (db) =>
    db.query<{ id: string; password_hash: string }>(`select id, password_hash from private.lookup_login($1)`, [
      parsed.data.email,
    ]),
  );
  const user = rows[0];
  if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
    return { ok: false, error: "Email or password is incorrect." };
  }
  await startSession(user.id);
  redirect("/app");
}

export async function signupAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  return runAction(async () => {
    let userId: string;
    if (supabaseConfigured()) {
      const created = await signUpSupabase(parsed.data);
      if (!created.ok) throw new UserError(created.error);
      userId = await linkSupabaseUser({ ...parsed.data, id: created.id });
    } else {
      const passwordHash = hashPassword(parsed.data.password);
      const rows = await withService("register-user", (db) =>
        db.query<{ register_user: string }>(`select private.register_user($1,$2,$3) as register_user`, [
          parsed.data.email,
          parsed.data.name,
          passwordHash,
        ]),
      );
      userId = rows[0].register_user;
    }
    await startSession(userId);
    redirect("/onboarding");
  });
}

export async function logoutAction() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(ORG_COOKIE);
  redirect("/login");
}

export async function createOrganizationAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = organizationSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    currency: formData.get("currency"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error) };
  return runAction(async () => {
    const rows = await withUser(user.id, (db) =>
      db.query<{ create_organization: string }>(
        `select private.create_organization($1,$2,$3,$4) as create_organization`,
        [parsed.data.name, parsed.data.slug, parsed.data.currency, parsed.data.timezone],
      ),
    );
    await startSession(user.id, rows[0].create_organization);
    redirect("/app");
  });
}

export async function acceptInvitationAction(_prev: ActionState = idleState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const hash = hashToken(token);
  const preview = await withService("invitation-preview", (db) =>
    db.query<{ email: string; accepted_at: string | null; revoked_at: string | null; expires_at: string }>(
      `select email, accepted_at, revoked_at, expires_at from invitations where token_hash = $1`,
      [hash],
    ),
  );
  const invite = preview[0];
  if (!invite) return { ok: false, error: "invitation not found" };
  if (invite.revoked_at) return { ok: false, error: "invitation revoked" };
  if (invite.accepted_at) return { ok: false, error: "invitation already accepted" };
  if (new Date(invite.expires_at).getTime() <= Date.now()) return { ok: false, error: "invitation expired" };

  return runAction(async () => {
    const existing = await withService("login-lookup", (db) =>
      db.query<{ id: string; password_hash: string }>(`select id, password_hash from private.lookup_login($1)`, [invite.email]),
    );
    let userId = existing[0]?.id;
    const session = await currentUser();
    if (userId) {
      if (session && session.id !== userId) throw new UserError("invitation email does not match");
      if (!session) {
        const password = String(formData.get("password") ?? "");
        if (!existing[0] || !verifyPassword(password, existing[0].password_hash)) {
          throw new UserError("Email or password is incorrect.");
        }
      }
    } else {
      const parsed = signupSchema.safeParse({
        name: formData.get("name"),
        email: invite.email,
        password: formData.get("password"),
      });
      if (!parsed.success) throw new UserError(fieldError(parsed.error));
      const passwordHash = hashPassword(parsed.data.password);
      const created = await withService("register-user", (db) =>
        db.query<{ register_user: string }>(`select private.register_user($1,$2,$3) as register_user`, [
          invite.email,
          parsed.data.name,
          passwordHash,
        ]),
      );
      userId = created[0].register_user;
    }
    if (!userId) throw new UserError("invitation not found");
    const orgRows = await withUser(userId, (db) =>
      db.query<{ accept_invitation: string }>(`select private.accept_invitation($1) as accept_invitation`, [hash]),
    );
    await startSession(userId, orgRows[0].accept_invitation);
    redirect("/app");
  });
}
