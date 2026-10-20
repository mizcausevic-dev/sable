import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { wrapPglite } from "./executor";
import { migrate } from "./migrate";
import { seedIfEmpty } from "./seed";

const command = process.argv[2];
const dataDir = path.resolve(process.env.DATA_DIR ?? ".data/pglite");
mkdirSync(dataDir, { recursive: true });
const db = await wrapPglite(new PGlite(dataDir));
await migrate(db);
if (command === "seed") {
  await seedIfEmpty(db);
  console.log("seed complete");
} else if (command === "migrate") {
  console.log("migrations applied");
} else {
  console.error("Use migrate or seed");
  process.exit(1);
}
process.exit(0);
