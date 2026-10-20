import { sumMinor } from "./money";

export type InvoiceSnapshot = {
  id: string;
  number: string;
  status: string;
  issuedOn: string | null;
  projectId: string | null;
  totalMinor: number;
  paidMinor: number;
};

export type PaymentSnapshot = {
  id: string;
  invoiceId: string;
  receivedOn: string;
  amountMinor: number;
  source: "manual" | "provider";
};

export type CostSnapshot = {
  id: string;
  projectId: string;
  workDate: string;
  costMinor: number;
};

export type FinancialReport = {
  empty: boolean;
  recognizedMinor: number;
  collectedMinor: number;
  manualCollectedMinor: number;
  providerCollectedMinor: number;
  outstandingMinor: number;
  costMinor: number;
  grossProfitMinor: number;
  marginBps: number | null;
  invoices: InvoiceSnapshot[];
  payments: PaymentSnapshot[];
  costs: CostSnapshot[];
};

function inRange(day: string | null, from: string, to: string): boolean {
  return day != null && day >= from && day <= to;
}

/**
 * Revenue is the sum of totals on issued, partial, and paid invoices whose issued_on is in range.
 * Outstanding is the current balance of those invoices (total minus every payment, not only payments in range).
 * Collected is payments whose received_on is in range, split by manual versus provider.
 * Profit uses recognized revenue minus delivery cost in the same range.
 * Margin is null when recognized revenue is zero so an empty range is not reported as 0% profit.
 */
export function financialReport(input: {
  from: string;
  to: string;
  invoices: InvoiceSnapshot[];
  payments: PaymentSnapshot[];
  costs: CostSnapshot[];
}): FinancialReport {
  const recognized = input.invoices.filter(
    (invoice) =>
      (invoice.status === "issued" || invoice.status === "partial" || invoice.status === "paid") &&
      inRange(invoice.issuedOn, input.from, input.to),
  );
  const payments = input.payments.filter((payment) => inRange(payment.receivedOn, input.from, input.to));
  const costs = input.costs.filter((cost) => inRange(cost.workDate, input.from, input.to));
  const recognizedMinor = sumMinor(recognized.map((invoice) => invoice.totalMinor));
  const outstandingMinor = sumMinor(
    recognized
      .filter((invoice) => invoice.status === "issued" || invoice.status === "partial")
      .map((invoice) => invoice.totalMinor - invoice.paidMinor),
  );
  const manualCollectedMinor = sumMinor(
    payments.filter((payment) => payment.source === "manual").map((payment) => payment.amountMinor),
  );
  const providerCollectedMinor = sumMinor(
    payments.filter((payment) => payment.source === "provider").map((payment) => payment.amountMinor),
  );
  const collectedMinor = manualCollectedMinor + providerCollectedMinor;
  const costMinor = sumMinor(costs.map((cost) => cost.costMinor));
  const grossProfitMinor = recognizedMinor - costMinor;
  const marginBps =
    recognizedMinor === 0 ? null : Math.round((grossProfitMinor * 10000) / recognizedMinor);
  return {
    empty: recognized.length === 0 && payments.length === 0 && costs.length === 0,
    recognizedMinor,
    collectedMinor,
    manualCollectedMinor,
    providerCollectedMinor,
    outstandingMinor,
    costMinor,
    grossProfitMinor,
    marginBps,
    invoices: recognized,
    payments,
    costs,
  };
}

export type BudgetRow = {
  projectId: string;
  projectName: string;
  revenueBudgetMinor: number | null;
  costBudgetMinor: number | null;
  recognizedMinor: number;
  costMinor: number;
};

export function budgetRows(input: {
  projects: { id: string; name: string; revenueBudgetMinor: number | null; costBudgetMinor: number | null }[];
  invoices: InvoiceSnapshot[];
  costs: CostSnapshot[];
  from: string;
  to: string;
}): BudgetRow[] {
  return input.projects.map((project) => {
    const recognizedMinor = sumMinor(
      input.invoices
        .filter(
          (invoice) =>
            invoice.projectId === project.id &&
            (invoice.status === "issued" || invoice.status === "partial" || invoice.status === "paid") &&
            inRange(invoice.issuedOn, input.from, input.to),
        )
        .map((invoice) => invoice.totalMinor),
    );
    const costMinor = sumMinor(
      input.costs
        .filter((cost) => cost.projectId === project.id && inRange(cost.workDate, input.from, input.to))
        .map((cost) => cost.costMinor),
    );
    return {
      projectId: project.id,
      projectName: project.name,
      revenueBudgetMinor: project.revenueBudgetMinor,
      costBudgetMinor: project.costBudgetMinor,
      recognizedMinor,
      costMinor,
    };
  });
}
