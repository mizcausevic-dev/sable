import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Executor } from "./executor";

export async function migrate(db: Executor): Promise<void> {
  const directory = path.join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    const present = await db.query<{ name: string | null }>(
      `select to_regclass('private.schema_migrations') as name`,
    );
    if (present[0]?.name) {
      const applied = await db.query(`select 1 from private.schema_migrations where id = $1`, [id]);
      if (applied.length > 0) continue;
    }
    await db.exec(readFileSync(path.join(directory, file), "utf8"));
  }
}
