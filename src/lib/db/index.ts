import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Executor } from "./executor";
import { wrapPglite } from "./executor";
import { migrate } from "./migrate";
import { seedIfEmpty } from "./seed";
import type { PrivilegedReason } from "../privileged";

type GlobalDb = {
  sableDb?: Promise<Executor>;
  sableBoot?: Promise<void>;
};

const globalDb = globalThis as typeof globalThis & GlobalDb;

async function openDatabase(): Promise<Executor> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(databaseUrl, {
      max: 4,
      prepare: false,
      connection: { application_name: "sable" },
    });
    type Queryable = { unsafe: (text: string, params?: readonly unknown[]) => Promise<unknown[]> };
    const wrap = (queryable: Queryable): Executor => ({
      async query<T>(text: string, params: readonly unknown[] = []) {
        const rows = await queryable.unsafe(text, params);
        return rows as T[];
      },
      async exec(text: string) {
        await queryable.unsafe(text);
      },
      transaction<T>(fn: (tx: Executor) => Promise<T>) {
        return sql.begin(async (tx) => fn(wrap(tx as unknown as Queryable))) as Promise<T>;
      },
    });
    return wrap(sql as unknown as Queryable);
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? ".data/pglite");
  mkdirSync(dataDir, { recursive: true });
  const pglite = new PGlite(dataDir);
  await pglite.waitReady;
  return wrapPglite(pglite);
}

export function getDb(): Promise<Executor> {
  globalDb.sableDb ??= openDatabase();
  return globalDb.sableDb;
}

export async function bootDatabase(): Promise<void> {
  globalDb.sableBoot ??= (async () => {
    const db = await getDb();
    if (!process.env.DATABASE_URL) await migrate(db);
    const seedOnBoot = process.env.SEED_ON_BOOT === "1" || process.env.NODE_ENV !== "production";
    if (seedOnBoot) await seedIfEmpty(db);
  })();
  return globalDb.sableBoot;
}

export async function withUser<T>(userId: string, fn: (db: Executor) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("invalid user");
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('app.user_id', $1, true)`, [userId]);
    await tx.exec(`set local role app_user`);
    return fn(tx);
  });
}

export async function withService<T>(
  reason: PrivilegedReason,
  fn: (db: Executor) => Promise<T>,
): Promise<T> {
  if (!reason) throw new Error("privileged call requires a reason");
  const db = await getDb();
  return db.transaction(async (tx) => fn(tx));
}
