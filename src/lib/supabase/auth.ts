import "server-only";
import { createClient } from "@supabase/supabase-js";
import { hashPassword } from "../password";
import { withService } from "../db";

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function browserSafeClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Supabase Auth is not configured");
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function verifySupabasePassword(email: string, password: string): Promise<{ id: string } | null> {
  const supabase = browserSafeClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return null;
  return { id: data.user.id };
}

export async function signUpSupabase(input: { email: string; password: string; name: string }): Promise<
  { ok: true; id: string } | { ok: false; error: string }
> {
  const supabase = browserSafeClient();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: { name: input.name } },
  });
  if (error || !data.user) return { ok: false, error: error?.message ?? "Supabase sign-up failed" };
  if (!data.session) {
    return { ok: false, error: "Confirm the email address in Supabase, then sign in. Local profile was not created." };
  }
  return { ok: true, id: data.user.id };
}

/** Links a Supabase Auth user id to the application profile. Uses the database owner, not the service-role key. */
export async function linkSupabaseUser(input: { id: string; email: string; name: string; password: string }): Promise<string> {
  const marker = hashPassword(input.password);
  const rows = await withService("supabase-user-link", (db) =>
    db.query<{ register_user_with_id: string }>(
      `select private.register_user_with_id($1::uuid, $2, $3, $4) as register_user_with_id`,
      [input.id, input.email, input.name, marker],
    ),
  );
  return rows[0].register_user_with_id;
}

export function supabaseServiceConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function serviceStorage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
