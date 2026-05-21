/**
 * File-attachment helpers for the `--file` flag on `messages send` and
 * `dm send`.
 *
 * Two stages:
 *
 *   1. `resolveFiles(patterns)` — turn the raw `--file` arg list (which
 *      Commander hands us as repeated entries) into an absolute,
 *      deduped path list. Globs are NOT expanded in v1; each entry must
 *      be a literal path. Globs in shells already get expanded before
 *      Commander sees them; the only callers who need explicit globbing
 *      are non-shell consumers (rare), and adding a glob dep just to
 *      cover that is over-fitting.
 *
 *   2. `uploadAttachments(client, paths)` — read each file from disk,
 *      detect MIME type by extension (server rejects octet-stream so
 *      this MUST be set), and POST to `/mcp/upload` sequentially.
 *      Returns the array of `UploadedAttachment` rows the caller passes
 *      to `client.sendMessage(...)` / `client.sendDm(...)`.
 *
 * Sequential (not parallel) uploads keep this simple and predictable
 * for the common case of 1–3 files. The bottleneck is the user picking
 * and naming the file, not the server.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import type { AnoApiClient, UploadedAttachment } from "../core/api-client.js";

/** Maximum total bytes uploaded in one CLI invocation. Mirrors the
 *  server's per-file cap × a reasonable batch size. */
const MAX_TOTAL_UPLOAD_BYTES = 25 * 1024 * 1024 * 5;

/** Maximum per-file size (matches `MAX_UPLOAD_SIZE` server-side). */
const MAX_PER_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Minimal extension → MIME map, scoped to types the server's
 * `ALLOWED_MIME_TYPES` set accepts (`server/utils.ts`). Anything else
 * surfaces as a clear "unsupported file type" error rather than a
 * cryptic server-side reject.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  // images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  // video
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  // audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  // documents
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".json": "application/json",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".log": "text/plain",
  ".yml": "text/plain",
  ".yaml": "text/plain",
};

export class FileAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileAttachmentError";
  }
}

/**
 * Normalise the raw `--file` Commander values (string | string[] | undefined)
 * into an absolute, deduped path list. Resolves relative paths against
 * `process.cwd()` so the calling shell's cwd is the source of truth.
 *
 * Returns `[]` for an absent/empty flag — no error.
 */
export function resolveFiles(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    // Commander variadic arrays come pre-split; comma-split as a
    // convenience for `--file a.png,b.png` so users can match the
    // `--to` flag's behaviour.
    for (const piece of entry.split(",")) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      const absolute = isAbsolute(trimmed)
        ? trimmed
        : resolve(process.cwd(), trimmed);
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      out.push(absolute);
    }
  }
  return out;
}

/**
 * Read a file from disk, validate it, and infer the MIME type from
 * its extension. Throws `FileAttachmentError` for anything the server
 * would reject (missing file, oversize, unknown extension) so the
 * error message is local and clear.
 */
export async function readFileForUpload(
  path: string,
): Promise<{ body: Buffer; filename: string; contentType: string }> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch {
    throw new FileAttachmentError(`File not found: ${path}`);
  }
  if (!info.isFile()) {
    throw new FileAttachmentError(`Not a regular file: ${path}`);
  }
  if (info.size === 0) {
    throw new FileAttachmentError(`File is empty: ${path}`);
  }
  if (info.size > MAX_PER_FILE_BYTES) {
    throw new FileAttachmentError(
      `File exceeds 25 MB limit: ${path} (${(info.size / 1024 / 1024).toFixed(1)} MB)`,
    );
  }
  const ext = extname(path).toLowerCase();
  const contentType = MIME_BY_EXTENSION[ext];
  if (!contentType) {
    throw new FileAttachmentError(
      `Unsupported file type "${ext || "(no extension)"}" for ${path}. ` +
        "Supported: images, video, audio, pdf, office docs, text, html, json, zip, tar, gz.",
    );
  }
  const body = await readFile(path);
  return { body, filename: basename(path), contentType };
}

/**
 * Upload N files sequentially via `client.upload(...)`. Pre-flight
 * validates total size; surfaces upload errors with the offending
 * filename so the user knows which file failed mid-batch.
 */
export async function uploadAttachments(
  client: Pick<AnoApiClient, "upload">,
  paths: string[],
): Promise<UploadedAttachment[]> {
  if (paths.length === 0) return [];

  // Pre-flight: read sizes first so we can fail fast on a 200 MB batch
  // rather than uploading 4 files and rejecting the 5th.
  const prepared: Array<{
    body: Buffer;
    filename: string;
    contentType: string;
  }> = [];
  let totalBytes = 0;
  for (const path of paths) {
    const file = await readFileForUpload(path);
    totalBytes += file.body.byteLength;
    prepared.push(file);
  }
  if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
    throw new FileAttachmentError(
      `Total upload size ${(totalBytes / 1024 / 1024).toFixed(1)} MB exceeds the ${
        MAX_TOTAL_UPLOAD_BYTES / 1024 / 1024
      } MB cap. Send fewer files or attach them in batches.`,
    );
  }

  const out: UploadedAttachment[] = [];
  for (const file of prepared) {
    try {
      const uploaded = await client.upload(file);
      out.push(uploaded);
    } catch (err) {
      // Preserve the original error type so the CLI's error handler
      // still maps AuthError → exit 4, NetworkError → exit 6, etc. We
      // only enrich the message with the offending filename.
      if (err instanceof Error) {
        err.message = `Upload failed for ${file.filename}: ${err.message}`;
        throw err;
      }
      throw new FileAttachmentError(
        `Upload failed for ${file.filename}: ${String(err)}`,
      );
    }
  }
  return out;
}
