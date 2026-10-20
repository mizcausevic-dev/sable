import { optionalOrg } from "@/server/context";
import { asText, searchRecords } from "@/server/load";

export async function GET(request: Request) {
  const ctx = await optionalOrg();
  if (!ctx) return Response.json({ error: "Sign in required" }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const rows = await searchRecords(ctx.user.id, ctx.org.organizationId, query);
  return Response.json(
    rows.map((row) => ({ kind: asText(row.kind), label: asText(row.label), href: asText(row.href) })),
    { headers: { "cache-control": "private, no-store" } },
  );
}
