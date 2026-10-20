/** Integer minor units. One USD cent is 1. Never use binary floating point for amounts. */

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function minorUnits(value: unknown): number {
  if (typeof value === "bigint") {
    if (value > SAFE || value < -SAFE) throw new Error("amount exceeds safe integer");
    return Number(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("amount must be an integer");
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error("amount exceeds safe integer");
    return parsed;
  }
  throw new Error("amount must be an integer");
}

export function lineTotalMinor(quantityMilli: number, unitAmountMinor: number): number {
  if (!Number.isInteger(quantityMilli) || !Number.isInteger(unitAmountMinor)) {
    throw new Error("money values must be integers");
  }
  const product = BigInt(quantityMilli) * BigInt(unitAmountMinor);
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + 500n) / 1000n;
  const result = negative ? -rounded : rounded;
  if (result > SAFE || result < -SAFE) throw new Error("amount exceeds safe integer");
  return Number(result);
}

export function costAmountMinor(minutes: number, hourlyRateMinor: number): number {
  if (!Number.isInteger(minutes) || !Number.isInteger(hourlyRateMinor)) {
    throw new Error("cost values must be integers");
  }
  const product = BigInt(minutes) * BigInt(hourlyRateMinor);
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + 30n) / 60n;
  const result = negative ? -rounded : rounded;
  if (result > SAFE || result < -SAFE) throw new Error("amount exceeds safe integer");
  return Number(result);
}

export function sumMinor(values: number[]): number {
  return values.reduce((total, value) => {
    if (!Number.isSafeInteger(value)) throw new Error("amount must be an integer");
    const next = total + value;
    if (!Number.isSafeInteger(next)) throw new Error("amount exceeds safe integer");
    return next;
  }, 0);
}

export function formatMinor(amountMinor: number, currency: string): string {
  const amount = minorUnits(amountMinor);
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${currency} ${grouped}.${fraction.toString().padStart(2, "0")}`;
}

export function formatQuantity(quantityMilli: number): string {
  if (!Number.isInteger(quantityMilli)) throw new Error("quantity must be an integer");
  const negative = quantityMilli < 0;
  const abs = Math.abs(quantityMilli);
  const whole = Math.floor(abs / 1000);
  const fraction = abs % 1000;
  const suffix = fraction === 0 ? "" : `.${fraction.toString().padStart(3, "0").replace(/0+$/, "")}`;
  return `${negative ? "-" : ""}${whole}${suffix}`;
}

export function parseQuantityToMilli(input: string): number {
  const text = input.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(text)) throw new Error("Enter a quantity with up to 3 decimal places");
  const [whole, fraction = ""] = text.split(".");
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  if (!Number.isSafeInteger(milli) || milli <= 0) throw new Error("Quantity must be greater than zero");
  return milli;
}

export function parseMajorToMinor(input: string): number {
  const text = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("Enter an amount with up to 2 decimal places");
  const [whole, fraction = ""] = text.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("Amount must be zero or greater");
  return minor;
}
