import { publicDbError } from "./errors";

export class UserError extends Error {}

export type ActionState = { ok: boolean; error?: string; notice?: string };
export const idleState: ActionState = { ok: true };

export function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

export async function runAction(fn: () => Promise<void>): Promise<ActionState> {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof UserError) return { ok: false, error: error.message };
    return { ok: false, error: publicDbError(error) };
  }
}
