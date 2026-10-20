import { withUser } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { can } from "@/lib/permissions";
import { financialReport } from "@/lib/reports";
import { optionalOrg } from "@/server/context";
import { loadFinancialSnapshots } from "@/server/sql";

function day(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export async function GET(request: Request) {
  const ctx = await optionalOrg();
  if (!ctx) return new Response("Sign in required", { status: 401 });
  if (!can(ctx.org.role, "reports.export")) return new Response("Permission denied", { status: 403 });
  const url = new URL(request.url);
  const from = day(url.searchParams.get("from"));
  const to = day(url.searchParams.get("to"));
  if (!from || !to || from > to) return new Response("Use from and to as YYYY-MM-DD", { status: 400 });
  const snapshots = await withUser(ctx.user.id, (db) => loadFinancialSnapshots(db, ctx.org.organizationId));
  const report = financialReport({ from, to, ...snapshots });
  const rows: (string | number)[][] = [
    ["record", "id", "reference", "status", "date", "amount_minor", "source", "currency"],
  ];
  for (const invoice of report.invoices) {
    rows.push(["invoice", invoice.id, invoice.number, invoice.status, invoice.issuedOn ?? "", invoice.totalMinor, "", ctx.org.currency]);
  }
  for (const payment of report.payments) {
    rows.push(["payment", payment.id, payment.invoiceId, "", payment.receivedOn, payment.amountMinor, payment.source, ctx.org.currency]);
  }
  for (const cost of report.costs) {
    rows.push(["delivery_cost", cost.id, cost.projectId, "", cost.workDate, cost.costMinor, "internal", ctx.org.currency]);
  }
  rows.push(["total", "recognized", "", "", from, report.recognizedMinor, "", ctx.org.currency]);
  rows.push(["total", "outstanding", "", "", to, report.outstandingMinor, "", ctx.org.currency]);
  rows.push(["total", "collected_manual", "", "", to, report.manualCollectedMinor, "manual", ctx.org.currency]);
  rows.push(["total", "collected_provider", "", "", to, report.providerCollectedMinor, "provider", ctx.org.currency]);
  rows.push(["total", "delivery_cost", "", "", to, report.costMinor, "internal", ctx.org.currency]);
  const body = toCsv(rows);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sable-${ctx.org.slug}-${from}-${to}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
