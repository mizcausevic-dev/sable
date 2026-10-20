import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { IDS } from "../src/lib/seed/ids";
import { financialReport } from "../src/lib/reports";

const dir = mkdtempSync(path.join(tmpdir(), "sable-"));
process.env.DATA_DIR = dir;
process.env.SEED_ON_BOOT = "1";
delete process.env.DATABASE_URL;

type DbModule = typeof import("../src/lib/db/index");
let dbm: DbModule;

beforeAll(async () => {
  dbm = await import("../src/lib/db/index");
  await dbm.bootDatabase();
}, 180000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("a client sees only the assigned account and not internal cost data", async () => {
  const clients = await dbm.withUser(IDS.ava, (db) => db.query<{ name: string }>(`select name from clients order by name`));
  expect(clients.map((row) => row.name)).toEqual(["Bright Parcel"]);
  const projects = await dbm.withUser(IDS.ava, (db) => db.query<{ name: string }>(`select name from projects order by name`));
  expect(projects.map((row) => row.name)).toEqual(["Parcel tracking refresh"]);
  const notes = await dbm.withUser(IDS.ava, (db) => db.query<{ body: string; internal: boolean }>(`select body, internal from client_notes`));
  expect(notes).toEqual([{ body: "Kickoff is on the October calendar.", internal: false }]);
  const rates = await dbm.withUser(IDS.ava, (db) => db.query(`select hourly_rate_minor from cost_rates`));
  expect(rates).toEqual([]);
  const costs = await dbm.withUser(IDS.ava, (db) => db.query(`select cost_amount_minor from time_entry_costs`));
  expect(costs).toEqual([]);
});

test("a user from the other organization cannot read or change Northline records", async () => {
  const clients = await dbm.withUser(IDS.owen, (db) => db.query<{ name: string }>(`select name from clients`));
  expect(clients.map((row) => row.name)).toEqual(["Lumen Market"]);
  const stolen = await dbm.withUser(IDS.owen, (db) =>
    db.query(`update clients set name = 'Stolen' where id = $1 returning id`, [IDS.bright]),
  );
  expect(stolen).toEqual([]);
  const still = await dbm.withUser(IDS.mira, (db) =>
    db.query<{ name: string }>(`select name from clients where id = $1`, [IDS.bright]),
  );
  expect(still[0]?.name).toBe("Bright Parcel");
  await expect(
    dbm.withUser(IDS.owen, (db) =>
      db.query(`insert into clients (organization_id, name, created_by) values ($1, 'Crossed', $2)`, [IDS.northline, IDS.owen]),
    ),
  ).rejects.toThrow();
});

test("the last owner cannot be demoted and task dependencies cannot cycle", async () => {
  await expect(
    dbm.withUser(IDS.mira, (db) =>
      db.query(`select private.set_member_role($1::uuid, $2::uuid, 'admin')`, [IDS.northline, IDS.mira]),
    ),
  ).rejects.toThrow(/last owner/);
  await expect(
    dbm.withUser(IDS.mira, (db) =>
      db.query(
        `insert into task_dependencies (organization_id, predecessor_id, successor_id) values ($1,$2,$3)`,
        [IDS.northline, IDS.board, IDS.spec],
      ),
    ),
  ).rejects.toThrow(/cycle/);
});

test("invoice balance matches its lines and payments, and the report matches those rows", async () => {
  const lines = await dbm.withUser(IDS.mira, (db) =>
    db.query<{ total: string }>(
      `select coalesce(sum(total_minor),0)::text as total from invoice_lines where invoice_id = $1`,
      [IDS.invoice],
    ),
  );
  const paid = await dbm.withUser(IDS.mira, (db) =>
    db.query<{ total: string }>(
      `select coalesce(sum(amount_minor),0)::text as total from payments where invoice_id = $1`,
      [IDS.invoice],
    ),
  );
  expect(Number(lines[0]?.total)).toBe(630_000);
  expect(Number(paid[0]?.total)).toBe(200_000);
  const { recordPayment } = await import("../src/server/mutations");
  const result = await dbm.withUser(IDS.mira, (db) =>
    recordPayment(db, {
      orgId: IDS.northline,
      invoiceId: IDS.invoice,
      actorId: IDS.mira,
      amountMinor: 10_000,
      receivedOn: "2026-10-08",
      source: "manual",
      provider: "",
      providerReference: "",
    }),
  );
  expect(result.paidMinor).toBe(210_000);
  expect(result.balanceMinor).toBe(420_000);
  expect(result.status).toBe("partial");
  const snapshots = await dbm.withUser(IDS.mira, async (db) => {
    const { loadFinancialSnapshots } = await import("../src/server/sql");
    return loadFinancialSnapshots(db, IDS.northline);
  });
  const report = financialReport({ from: "2026-10-01", to: "2026-10-31", ...snapshots });
  const lineSum = report.invoices.reduce((sum, invoice) => sum + invoice.totalMinor, 0);
  expect(report.recognizedMinor).toBe(lineSum);
  expect(report.recognizedMinor).toBe(630_000);
  expect(report.collectedMinor).toBe(210_000);
  expect(report.outstandingMinor).toBe(420_000);
  expect(report.manualCollectedMinor).toBe(210_000);
  expect(report.providerCollectedMinor).toBe(0);
});

test("ordinary sessions cannot insert audit rows", async () => {
  await expect(
    dbm.withUser(IDS.mira, (db) =>
      db.query(
        `insert into audit_events (organization_id, actor_id, action, entity_type) values ($1,$2,'forged','client')`,
        [IDS.northline, IDS.mira],
      ),
    ),
  ).rejects.toThrow(/permission denied|row-level security/i);
});

test("the organization switcher query returns only the caller's membership", async () => {
  const visible = await dbm.withUser(IDS.owen, (db) =>
    db.query<{ role: string }>(`select role from memberships where organization_id = $1 order by role`, [IDS.harbor]),
  );
  expect(visible.map((row) => row.role).sort()).toEqual(["contributor", "owner"]);
  const own = await dbm.withUser(IDS.owen, (db) =>
    db.query<{ role: string }>(`select role from memberships where user_id = $1`, [IDS.owen]),
  );
  expect(own).toEqual([{ role: "owner" }]);
});

test("a contributor does not receive internal cost rows", async () => {
  const costs = await dbm.withUser(IDS.leo, (db) => db.query(`select cost_amount_minor from time_entry_costs`));
  expect(costs).toEqual([]);
  const time = await dbm.withUser(IDS.leo, (db) => db.query(`select id from time_entries`));
  expect(time.length).toBeGreaterThan(0);
});
