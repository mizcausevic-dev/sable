import { describe, expect, test } from "vitest";
import { csvCell, toCsv } from "../src/lib/csv";
import { validateCustomFields } from "../src/lib/custom-fields";
import { costAmountMinor, lineTotalMinor, parseMajorToMinor, sumMinor } from "../src/lib/money";
import { can, permissionsFor } from "../src/lib/permissions";
import { financialReport } from "../src/lib/reports";
import { invoiceStatusAfterPayment, canTransitionInvoice, userInvoiceActions } from "../src/lib/states";
import { sniffAllowed } from "../src/lib/storage";
import { openSession, sealSession } from "../src/lib/tokens";

describe("money", () => {
  test("line totals and time cost stay in integer minor units", () => {
    expect(lineTotalMinor(1000, 450_000)).toBe(450_000);
    expect(lineTotalMinor(12_000, 15_000)).toBe(180_000);
    expect(costAmountMinor(360, 8_500)).toBe(51_000);
    expect(sumMinor([450_000, 180_000])).toBe(630_000);
    expect(parseMajorToMinor("12.50")).toBe(1250);
    expect(() => parseMajorToMinor("12.505")).toThrow(/decimal/);
    expect(() => lineTotalMinor(1.5, 100)).toThrow(/integer/);
  });
});

describe("permissions", () => {
  test("clients cannot read internal finance and contributors cannot export the ledger", () => {
    expect(can("client", "projects.read")).toBe(true);
    expect(can("client", "finance.read")).toBe(false);
    expect(can("client", "finance.internal")).toBe(false);
    expect(can("contributor", "reports.operational")).toBe(true);
    expect(can("contributor", "reports.export")).toBe(false);
    expect(can("contributor", "finance.internal")).toBe(false);
    expect(permissionsFor("owner")).toContain("org.audit");
    expect(permissionsFor("manager")).not.toContain("org.settings");
  });
});

describe("invoices", () => {
  test("payment status follows the remaining balance and people cannot mark paid directly", () => {
    expect(invoiceStatusAfterPayment(630_000, 200_000)).toBe("partial");
    expect(invoiceStatusAfterPayment(630_000, 630_000)).toBe("paid");
    expect(userInvoiceActions("issued")).toEqual(["void"]);
    expect(userInvoiceActions("partial")).not.toContain("paid");
    expect(canTransitionInvoice("draft", "issued")).toBe(true);
    expect(() => invoiceStatusAfterPayment(100, 101)).toThrow(/exceeds/);
  });
});

describe("reports", () => {
  test("recognized, outstanding, and collected match the source rows", () => {
    const report = financialReport({
      from: "2026-10-01",
      to: "2026-10-31",
      invoices: [
        { id: "a", number: "INV-1", status: "partial", issuedOn: "2026-10-01", projectId: "p", totalMinor: 630_000, paidMinor: 200_000 },
        { id: "b", number: "INV-2", status: "draft", issuedOn: null, projectId: "p", totalMinor: 100_000, paidMinor: 0 },
      ],
      payments: [
        { id: "m", invoiceId: "a", receivedOn: "2026-10-05", amountMinor: 200_000, source: "manual" },
        { id: "v", invoiceId: "a", receivedOn: "2026-11-01", amountMinor: 50, source: "provider" },
      ],
      costs: [{ id: "c", projectId: "p", workDate: "2026-10-03", costMinor: 51_000 }],
    });
    expect(report.recognizedMinor).toBe(630_000);
    expect(report.outstandingMinor).toBe(430_000);
    expect(report.collectedMinor).toBe(200_000);
    expect(report.providerCollectedMinor).toBe(0);
    expect(report.costMinor).toBe(51_000);
    expect(report.grossProfitMinor).toBe(579_000);
    expect(report.invoices.map((invoice) => invoice.totalMinor).reduce((sum, value) => sum + value, 0)).toBe(report.recognizedMinor);
  });

  test("an empty range does not invent a margin", () => {
    const report = financialReport({ from: "2026-01-01", to: "2026-01-31", invoices: [], payments: [], costs: [] });
    expect(report.empty).toBe(true);
    expect(report.marginBps).toBeNull();
    expect(report.recognizedMinor).toBe(0);
  });
});

describe("csv", () => {
  test("formula prefixes are neutralized", () => {
    expect(csvCell("=cmd()")).toBe("'=cmd()");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(toCsv([["name", "=1+1"]])).toBe("name,'=1+1\r\n");
  });
});

describe("custom fields", () => {
  test("unknown and missing required values are rejected", () => {
    const definitions = [
      { key: "industry", label: "Industry", fieldType: "select" as const, required: true, options: ["Logistics"], archived: false },
    ];
    expect(validateCustomFields(definitions, { industry: "Logistics" }).ok).toBe(true);
    expect(validateCustomFields(definitions, {}).ok).toBe(false);
    expect(validateCustomFields(definitions, { other: "x" }).ok).toBe(false);
  });
});

describe("sessions", () => {
  test("a sealed session opens and a tampered token does not", () => {
    const token = sealSession("11111111-1111-4111-8111-111111111101");
    expect(openSession(token)?.sub).toBe("11111111-1111-4111-8111-111111111101");
    expect(openSession(`${token}x`)).toBeNull();
  });
});

describe("uploads", () => {
  test("type and magic bytes both have to match", () => {
    expect(sniffAllowed("application/pdf", new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(sniffAllowed("application/pdf", new TextEncoder().encode("hello"))).toBe(false);
    expect(sniffAllowed("application/zip", new TextEncoder().encode("PK"))).toBe(false);
    expect(sniffAllowed("text/plain", new Uint8Array([0]))).toBe(false);
  });
});
