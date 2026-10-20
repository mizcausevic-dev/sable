import { UserError } from "@/lib/action";
import { publicDbError } from "@/lib/errors";
import { saveUpload } from "@/server/files";

function back(request: Request): string {
  const referer = request.headers.get("referer");
  if (!referer) return "/app";
  try {
    const url = new URL(referer);
    if (url.origin !== new URL(request.url).origin) return "/app";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/app";
  }
}

export async function POST(request: Request) {
  const destination = back(request);
  try {
    await saveUpload(await request.formData());
    return Response.redirect(new URL(destination, request.url), 303);
  } catch (error) {
    const message = error instanceof UserError ? error.message : publicDbError(error);
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Upload rejected</title><body><main><h1>Upload rejected</h1><p>${message.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] ?? char)}</p><p><a href="${destination}">Back</a></p></main></body></html>`;
    return new Response(html, { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
  }
}
