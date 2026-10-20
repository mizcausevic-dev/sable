export type FieldType = "text" | "number" | "date" | "select";

export type FieldDefinition = {
  key: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  options: string[];
  archived: boolean;
};

export function validateCustomFields(
  definitions: FieldDefinition[],
  input: unknown,
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (input == null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Custom fields must be an object" };
  }
  const source = input as Record<string, unknown>;
  const active = definitions.filter((definition) => !definition.archived);
  const known = new Set(active.map((definition) => definition.key));
  for (const key of Object.keys(source)) {
    if (!known.has(key)) return { ok: false, error: `Unknown custom field ${key}` };
  }
  const value: Record<string, string> = {};
  for (const definition of active) {
    const raw = source[definition.key];
    if (raw == null || raw === "") {
      if (definition.required) return { ok: false, error: `${definition.label} is required` };
      continue;
    }
    if (typeof raw !== "string" && typeof raw !== "number") {
      return { ok: false, error: `${definition.label} is not a supported value` };
    }
    const text = String(raw).trim();
    if (definition.fieldType === "text") {
      if (text.length > 200) return { ok: false, error: `${definition.label} is too long` };
      value[definition.key] = text;
    } else if (definition.fieldType === "number") {
      if (!/^-?\d+(\.\d+)?$/.test(text)) return { ok: false, error: `${definition.label} must be a decimal` };
      value[definition.key] = text;
    } else if (definition.fieldType === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, error: `${definition.label} must be YYYY-MM-DD` };
      value[definition.key] = text;
    } else if (!definition.options.includes(text)) {
      return { ok: false, error: `${definition.label} is not one of the configured options` };
    } else {
      value[definition.key] = text;
    }
  }
  return { ok: true, value };
}
