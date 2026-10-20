import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const ALLOWED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
]);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function isAllowedMime(mime: string): boolean {
  return ALLOWED.has(mime);
}

export function storageRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? ".data/pglite");
}

export function assertStorageKey(key: string): void {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(key)) throw new Error("invalid storage key");
}

export function absoluteStoragePath(key: string): string {
  assertStorageKey(key);
  const root = path.join(storageRoot(), "storage");
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("invalid storage key");
  return full;
}

export async function writeStoredFile(key: string, bytes: Uint8Array): Promise<void> {
  const full = absoluteStoragePath(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(absoluteStoragePath(key));
}

export function storedFileExists(key: string): boolean {
  return existsSync(absoluteStoragePath(key));
}

export function streamStoredFile(key: string): Readable {
  return createReadStream(absoluteStoragePath(key));
}

export function sniffAllowed(mime: string, bytes: Uint8Array): boolean {
  if (!ALLOWED.has(mime) || bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return false;
  const head = Buffer.from(bytes.subarray(0, 16));
  if (mime === "application/pdf") return head.subarray(0, 4).toString("utf8") === "%PDF";
  if (mime === "image/png") return head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mime === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === "image/gif") return head.subarray(0, 4).toString("utf8") === "GIF8";
  if (mime === "image/webp") {
    return head.subarray(0, 4).toString("utf8") === "RIFF" && head.subarray(8, 12).toString("utf8") === "WEBP";
  }
  if (mime === "text/plain" || mime === "text/csv") {
    if (head.includes(0)) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function safeFilename(name: string): string {
  const base = name.replaceAll("\\", "/").split("/").pop() ?? "file";
  const cleaned = base.replace(/[\r\n"]/g, "").replace(/[^\w.\- ()]/g, "_").slice(0, 180);
  return cleaned || "file";
}
