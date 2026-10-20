import { safeFilename } from "@/lib/storage";
import { loadDownload, readAuthorizedBytes } from "@/server/files";

export async function GET(_request: Request, context: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await context.params;
  const file = await loadDownload(fileId);
  if (!file) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readAuthorizedBytes(file.storage_key);
    const filename = safeFilename(file.filename);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": file.mime_type,
        "content-disposition": `attachment; filename="${filename}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return new Response("File bytes are missing", { status: 404 });
  }
}
