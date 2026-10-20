const SAFE = [
  "last owner cannot be removed or demoted",
  "dependency cycle detected",
  "template dependency cycle detected",
  "task parent cycle detected",
  "task cannot parent itself",
  "parent task must belong to the same project",
  "dependencies must stay inside one project",
  "template dependency keys must exist on the template",
  "project access requires client-role access to that client",
  "client access requires the client role",
  "line total does not match quantity and unit amount",
  "lines are locked after the document leaves draft",
  "payments are only accepted on issued invoices",
  "payment exceeds outstanding balance",
  "draft or void invoice cannot have payments",
  "issued invoice must have a positive total",
  "issued invoice must have zero payments",
  "paid invoice balance must be zero",
  "partial invoice must have a remaining balance",
  "payments exceed invoice total",
  "seat limit reached",
  "project limit reached",
  "storage limit reached",
  "invitation not found",
  "invitation revoked",
  "invitation already accepted",
  "invitation expired",
  "invitation email does not match",
  "accepted invitations cannot be revoked",
  "not allowed to revoke this invitation",
  "not allowed to manage members",
  "only an owner can change ownership",
  "only an owner can remove an owner",
  "membership not found",
  "tasks can only be assigned to staff",
  "cost amount does not match minutes and rate",
  "organization_id is immutable",
  "authentication required",
  "illegal estimate transition",
  "illegal proposal transition",
  "illegal invoice transition",
];

export function publicDbError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  for (const known of SAFE) {
    if (message.includes(known)) {
      if (known.startsWith("illegal")) return message.split("\n")[0] ?? known;
      return known;
    }
  }
  if (message.includes("row-level security") || message.includes("permission denied")) {
    return "You do not have access to do that.";
  }
  if (message.includes("duplicate key") || message.includes("unique")) {
    return "That value is already in use.";
  }
  if (message.includes("violates check constraint")) {
    return "A value was outside the allowed set.";
  }
  return "The change was rejected.";
}
