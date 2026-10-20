/** RFC-style CSV with a spreadsheet-formula guard. Cells that start with = + - @ or whitespace get a leading apostrophe. */

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (FORMULA.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
