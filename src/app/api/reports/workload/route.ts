import { toCsv } from "@/lib/csv";
import { can } from "@/lib/permissions";
import { optionalOrg } from "@/server/context";
import { asMinor, asText, loadWorkload } from "@/server/load";

export async function GET() {
  const ctx = await optionalOrg();
  if (!ctx) return new Response("Sign in required", { status: 401 });
  if (!can(ctx.org.role, "reports.export") && !can(ctx.org.role, "reports.operational")) {
    return new Response("Permission denied", { status: 403 });
  }
  const selfOnly = !can(ctx.org.role, "reports.financial");
  const rows = await loadWorkload(ctx.user.id, ctx.org.organizationId, selfOnly);
  const body = toCsv([
    ["person_id", "person", "open_tasks", "weekly_minutes", "availability_configured"],
    ...rows.map((row) => [
      asText(row.id),
      asText(row.name),
      asMinor(row.open_tasks),
      asMinor(row.minutes),
      asMinor(row.windows) > 0 ? "yes" : "no",
    ]),
  ]);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sable-${ctx.org.slug}-workload.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
