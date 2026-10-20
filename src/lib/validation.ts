import { z } from "zod";
import { isTimeZone } from "./time";

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const signupSchema = z.object({
  name: trimmed(120),
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(200),
});

export const loginSchema = z.object({
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(200),
});

export const organizationSchema = z.object({
  name: trimmed(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens"),
  currency: z.enum(CURRENCIES),
  timezone: z.string().refine(isTimeZone, "Choose a valid IANA timezone"),
});

export const organizationSettingsSchema = z.object({
  name: trimmed(120),
  timezone: z.string().refine(isTimeZone, "Choose a valid IANA timezone"),
});

export const invitationSchema = z.object({
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(["owner", "admin", "manager", "contributor", "client"]),
});

export const clientSchema = z.object({
  name: trimmed(160),
  stage: z.enum(["lead", "qualified", "active", "paused", "closed"]),
  website: z.string().trim().max(300).optional().or(z.literal("")),
});

export const contactSchema = z.object({
  name: trimmed(120),
  email: z.email().max(254).transform((value) => value.toLowerCase()).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  title: z.string().trim().max(120).optional().or(z.literal("")),
});

export const noteSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  internal: z.boolean(),
});

export const fieldDefinitionSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,40}$/),
  label: trimmed(80),
  fieldType: z.enum(["text", "number", "date", "select"]),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(80)).max(20),
});

export const projectSchema = z.object({
  clientId: z.uuid(),
  name: trimmed(160),
  status: z.enum(["planned", "active", "on_hold", "completed", "canceled"]),
  description: z.string().trim().max(4000),
  timezone: z.string().refine(isTimeZone, "Choose a valid IANA timezone"),
  startOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  endOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  templateId: z.uuid().optional().or(z.literal("")),
});

export const taskSchema = z.object({
  title: trimmed(200),
  detail: z.string().trim().max(8000),
  status: z.enum(["backlog", "ready", "in_progress", "blocked", "done"]),
  clientVisible: z.boolean(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  parentTaskId: z.uuid().optional().or(z.literal("")),
  milestoneId: z.uuid().optional().or(z.literal("")),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  internal: z.boolean(),
});

export const lineSchema = z.object({
  description: trimmed(300),
  quantity: z.string().trim(),
  unitAmount: z.string().trim(),
});

export const documentSchema = z.object({
  clientId: z.uuid(),
  projectId: z.uuid().optional().or(z.literal("")),
  title: trimmed(160),
  lines: z.array(lineSchema).min(1).max(40),
});

export const paymentSchema = z.object({
  amount: z.string().trim(),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(["manual", "provider"]),
  provider: z.string().trim().max(80).optional().or(z.literal("")),
  providerReference: z.string().trim().max(120).optional().or(z.literal("")),
});

export const timeEntrySchema = z.object({
  projectId: z.uuid(),
  taskId: z.uuid().optional().or(z.literal("")),
  userId: z.uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minutes: z.coerce.number().int().positive().max(1440),
  billable: z.boolean(),
  note: z.string().trim().max(1000),
});

export const budgetSchema = z.object({
  revenue: z.string().trim().optional().or(z.literal("")),
  cost: z.string().trim().optional().or(z.literal("")),
});

export const costRateSchema = z.object({
  userId: z.uuid(),
  hourly: z.string().trim(),
  effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine((value) => value.from <= value.to, "The start date must be on or before the end date");

export function fieldError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again";
}
