export const COMMERCIAL_STATUSES = ["draft", "sent", "accepted", "declined", "withdrawn", "expired"] as const;
export const INVOICE_STATUSES = ["draft", "issued", "partial", "paid", "void"] as const;
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number];
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const commercial: Record<CommercialStatus, readonly CommercialStatus[]> = {
  draft: ["sent", "withdrawn"],
  sent: ["accepted", "declined", "withdrawn", "expired"],
  accepted: [],
  declined: [],
  withdrawn: [],
  expired: [],
};

const invoice: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["issued", "void"],
  issued: ["partial", "paid", "void"],
  partial: ["paid", "void"],
  paid: [],
  void: [],
};

export function canTransitionCommercial(from: CommercialStatus, to: CommercialStatus): boolean {
  return from === to || commercial[from].includes(to);
}

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return from === to || invoice[from].includes(to);
}

export function nextCommercial(from: CommercialStatus): CommercialStatus[] {
  return [...commercial[from]];
}

/** Status choices a person can request. partial and paid are set by the payment transaction. */
export function userInvoiceActions(from: InvoiceStatus): InvoiceStatus[] {
  if (from === "draft") return ["issued", "void"];
  if (from === "issued" || from === "partial") return ["void"];
  return [];
}

export function invoiceStatusAfterPayment(totalMinor: number, paidMinor: number): InvoiceStatus {
  if (paidMinor <= 0) return "issued";
  if (paidMinor < totalMinor) return "partial";
  if (paidMinor === totalMinor) return "paid";
  throw new Error("payment exceeds outstanding balance");
}
