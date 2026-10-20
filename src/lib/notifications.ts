export const NOTIFICATION_KINDS = [
  "invitation_accepted",
  "task_assigned",
  "invoice_issued",
  "comment_added",
  "member_joined",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/** In-app rows are written. Email and push flags are stored and are not delivered. */
export const NOTIFICATION_CHANNELS = {
  inApp: "implemented",
  email: "preference only",
  push: "preference only",
} as const;
