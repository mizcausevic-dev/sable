import type { Executor } from "@/lib/db/executor";
import { minorUnits } from "@/lib/money";
import type { PaymentSnapshot, InvoiceSnapshot, CostSnapshot } from "@/lib/reports";

export function asText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function asDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : text;
}

export function asMinor(value: unknown): number {
  if (value == null) return 0;
  return minorUnits(value);
}

export function asMinorOrNull(value: unknown): number | null {
  if (value == null) return null;
  return minorUnits(value);
}

export function likeContains(query: string): string {
  const cleaned = query.trim().slice(0, 80).replace(/[\\%_]/g, "");
  return `%${cleaned}%`;
}

export async function loadFinancialSnapshots(db: Executor, orgId: string): Promise<{
  invoices: InvoiceSnapshot[];
  payments: PaymentSnapshot[];
  costs: CostSnapshot[];
}> {
  const invoices = await db.query(
    `select i.id, i.number, i.status, i.issued_on::text as issued_on, i.project_id,
            coalesce((select sum(total_minor) from invoice_lines l where l.invoice_id = i.id), 0) as total_minor,
            coalesce((select sum(amount_minor) from payments p where p.invoice_id = i.id), 0) as paid_minor
     from invoices i
     where i.organization_id = $1`,
    [orgId],
  );
  const payments = await db.query(
    `select p.id, p.invoice_id, p.received_on::text as received_on, p.amount_minor, p.source
     from payments p
     where p.organization_id = $1`,
    [orgId],
  );
  const costs = await db.query(
    `select c.time_entry_id as id, t.project_id, t.work_date::text as work_date, c.cost_amount_minor
     from time_entry_costs c
     join time_entries t on t.id = c.time_entry_id
     where c.organization_id = $1`,
    [orgId],
  );
  return {
    invoices: invoices.map((row) => ({
      id: asText(row.id),
      number: asText(row.number),
      status: asText(row.status),
      issuedOn: asDate(row.issued_on),
      projectId: row.project_id ? asText(row.project_id) : null,
      totalMinor: asMinor(row.total_minor),
      paidMinor: asMinor(row.paid_minor),
    })),
    payments: payments.map((row) => ({
      id: asText(row.id),
      invoiceId: asText(row.invoice_id),
      receivedOn: asDate(row.received_on) ?? "",
      amountMinor: asMinor(row.amount_minor),
      source: asText(row.source) === "provider" ? "provider" : "manual",
    })),
    costs: costs.map((row) => ({
      id: asText(row.id),
      projectId: asText(row.project_id),
      workDate: asDate(row.work_date) ?? "",
      costMinor: asMinor(row.cost_amount_minor),
    })),
  };
}
