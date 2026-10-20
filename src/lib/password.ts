import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384;
const r = 8;
const p = 1;
const keyLen = 32;

export function hashPassword(password: string, salt = randomBytes(16)): string {
  const hash = scryptSync(password, salt, keyLen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex || !nRaw || !rRaw || !pRaw) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
  });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Fixed salt for fictional seed users so the hash is deterministic. Not used for real signups. */
export const SEED_SALT = Buffer.from("sable-seed-v1-salt!", "utf8");
export const SEED_PASSWORD = "Sable-demo-1";
