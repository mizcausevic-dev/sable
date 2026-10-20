import "server-only";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { UserError } from "@/lib/action";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import {
  absoluteStoragePath,
  isAllowedMime,
  readStoredFile,
  safeFilename,
  sniffAllowed,
  storedFileExists,
  writeStoredFile,
} from "@/lib/storage";
import { serviceStorage } from "@/lib/supabase/auth";
import { requireOrg } from "./context";

const BUCKET = "sable-private";
const ENTITIES = new Set(["client", "project", "task"]);

const EXTENSIONS: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  txt: "text/plain",
  csv: "text/csv",
};

function declaredMime(file: File): string {
  if (isAllowedMime(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONS[ext] ?? "";
}

async function putBytes(key: string, bytes: Uint8Array, mime: string) {
  const remote = serviceStorage();
  if (remote) {
    const { error } = await remote.storage.from(BUCKET).upload(key, bytes, {
      contentType: mime,
      upsert: false,
    });
    if (error) throw new Error(error.message);
    return;
  }
  await writeStoredFile(key, bytes);
}

async function removeBytes(key: string) {
  const remote = serviceStorage();
  if (remote) {
    await remote.storage.from(BUCKET).remove([key]);
  }
  if (storedFileExists(key)) await unlink(absoluteStoragePath(key));
}

export async function readAuthorizedBytes(key: string): Promise<Buffer> {
  const remote = serviceStorage();
  if (remote) {
    const { data, error } = await remote.storage.from(BUCKET).download(key);
    if (data && !error) return Buffer.from(await data.arrayBuffer());
  }
  if (storedFileExists(key)) return readStoredFile(key);
  throw new Error("file bytes are missing");
}

export async function saveUpload(form: FormData): Promise<{ id: string; filename: string }> {
  const ctx = await requireOrg();
  if (!can(ctx.org.role, "files.write")) throw new UserError("You do not have access to do that.");
  const entityType = String(form.get("entityType") ?? "");
  const entityId = String(form.get("entityId") ?? "");
  const file = form.get("file");
  if (!ENTITIES.has(entityType) || !/^[0-9a-f-]{36}$/i.test(entityId)) {
    throw new UserError("Choose a client, project, or task in this organization.");
  }
  if (!(file instanceof File) || file.size === 0) throw new UserError("Choose a file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = declaredMime(file);
  if (!sniffAllowed(mime, bytes)) {
    throw new UserError("Upload a PDF, PNG, JPEG, WebP, GIF, plain text, or CSV file up to 10 MB.");
  }
  const id = randomUUID();
  const key = `${ctx.org.organizationId}/${id}`;
  const filename = safeFilename(file.name);
  const internal = form.get("internal") === "on" || form.get("internal") === "true";
  await putBytes(key, bytes, mime);
  try {
    await withUser(ctx.user.id, async (db) => {
      const table = entityType === "client" ? "clients" : entityType === "project" ? "projects" : "tasks";
      const visible = await db.query(`select id from ${table} where id = $1 and organization_id = $2`, [
        entityId,
        ctx.org.organizationId,
      ]);
      if (!visible[0]) throw new UserError("That record is not in this organization.");
      const room = await db.query<{ within_storage_limit: boolean }>(
        `select private.within_storage_limit($1::uuid, $2::int) as within_storage_limit`,
        [ctx.org.organizationId, bytes.byteLength],
      );
      if (!room[0]?.within_storage_limit) throw new UserError("storage limit reached");
      await db.query(
        `insert into attachments (id, organization_id, entity_type, entity_id, storage_key, filename, mime_type, byte_size, internal, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, ctx.org.organizationId, entityType, entityId, key, filename, mime, bytes.byteLength, internal, ctx.user.id],
      );
      await db.query(`select private.write_audit($1::uuid, 'file.uploaded', 'attachment', $2::uuid, $3::jsonb)`, [
        ctx.org.organizationId,
        id,
        JSON.stringify({ filename, entityType, internal }),
      ]);
    });
  } catch (error) {
    await removeBytes(key);
    throw error;
  }
  return { id, filename };
}

export async function loadDownload(fileId: string) {
  const ctx = await requireOrg();
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const rows = await withUser(ctx.user.id, (db) =>
    db.query<{ filename: string; mime_type: string; storage_key: string }>(
      `select filename, mime_type, storage_key from attachments where id = $1 and organization_id = $2`,
      [fileId, ctx.org.organizationId],
    ),
  );
  return rows[0] ?? null;
}
