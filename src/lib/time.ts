export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Calendar day in an IANA zone. en-CA formats as YYYY-MM-DD. */
export function todayInTimeZone(timeZone: string, now = new Date()): string {
  if (!isTimeZone(timeZone)) throw new Error("unknown timezone");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatTimestamp(value: string | Date, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatMinutes(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0) throw new Error("minutes must be a positive integer");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${rest.toString().padStart(2, "0")}m`;
}

export function monthBounds(month: string): { start: string; end: string; label: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("month must be YYYY-MM");
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  if (monthIndex < 1 || monthIndex > 12) throw new Error("month must be YYYY-MM");
  const start = `${month}-01`;
  const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const end = `${month}-${String(last).padStart(2, "0")}`;
  const label = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex - 1, 1)));
  return { start, end, label };
}

export function shiftMonth(month: string, delta: number): string {
  const [yearText, monthText] = month.split("-");
  const index = Number(yearText) * 12 + (Number(monthText) - 1) + delta;
  const year = Math.floor(index / 12);
  const next = (index % 12) + 1;
  return `${year}-${String(next).padStart(2, "0")}`;
}
