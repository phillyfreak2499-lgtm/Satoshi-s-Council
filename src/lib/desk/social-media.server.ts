import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

/** Persistent social assets for X (portraits, win cards). Lives on the Render
 *  disk next to lab/, never in the git tree (`data/` at repo root is forbidden). */
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4"]);
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_MP4 = 25 * 1024 * 1024;

export function socialDir(): string {
  const env = process.env.DESK_DATA_DIR?.trim();
  if (env) return join(env, "social");
  const render = "/opt/render/project/src/data";
  if (existsSync(render)) return join(render, "social");
  return join(process.cwd(), ".data", "social");
}

/** Prefer SOCIAL_UPLOAD_KEY; fall back to DESK_ADMIN_KEY so one secret works. */
export function socialUploadKeyOk(given: unknown): boolean {
  const want = process.env.SOCIAL_UPLOAD_KEY?.trim() || process.env.DESK_ADMIN_KEY?.trim();
  if (!want || typeof given !== "string" || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function socialUploadConfigured(): boolean {
  return Boolean(process.env.SOCIAL_UPLOAD_KEY?.trim() || process.env.DESK_ADMIN_KEY?.trim());
}

function contentTypeFor(ext: string): string {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

function extFromContentType(ct: string | null | undefined): string | null {
  const c = (ct ?? "").split(";")[0].trim().toLowerCase();
  if (c === "image/png") return ".png";
  if (c === "image/jpeg" || c === "image/jpg") return ".jpg";
  if (c === "image/webp") return ".webp";
  if (c === "image/gif") return ".gif";
  if (c === "video/mp4") return ".mp4";
  return null;
}

export function sanitizeStem(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\.[a-z0-9]+$/i, "");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(s)) return null;
  return s;
}

export type SaveSocialInput = {
  bytes: Uint8Array;
  contentType?: string | null;
  /** Optional stable stem (e.g. seat-intro-day-03). Random id if omitted. */
  id?: string | null;
  /** Optional original filename — used only for extension. */
  filename?: string | null;
};

export type SaveSocialResult =
  | { ok: true; id: string; path: string; urlPath: string; contentType: string; bytes: number }
  | { ok: false; status: number; error: string };

export async function saveSocialAsset(input: SaveSocialInput): Promise<SaveSocialResult> {
  const fromName = input.filename ? extname(input.filename).toLowerCase() : "";
  const fromType = extFromContentType(input.contentType);
  const ext = (ALLOWED_EXT.has(fromName) ? fromName : null) || fromType;
  if (!ext || !ALLOWED_EXT.has(ext)) {
    return { ok: false, status: 415, error: "allowed types: png jpg jpeg webp gif mp4" };
  }
  const max = ext === ".mp4" ? MAX_MP4 : MAX_IMAGE;
  if (!input.bytes?.length) return { ok: false, status: 400, error: "empty body" };
  if (input.bytes.length > max) {
    return { ok: false, status: 413, error: `max ${Math.round(max / 1e6)} MB for ${ext}` };
  }
  let stem = input.id ? sanitizeStem(input.id) : null;
  if (input.id && !stem) return { ok: false, status: 400, error: "id must be [a-z0-9_-], max 64" };
  if (!stem) {
    const hash = createHash("sha256").update(input.bytes).digest("hex").slice(0, 10);
    stem = `${hash}-${randomBytes(3).toString("hex")}`;
  }
  const id = `${stem}${ext}`;
  const dir = socialDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, id);
  await writeFile(path, input.bytes);
  return {
    ok: true,
    id,
    path,
    urlPath: `/media/social/${id}`,
    contentType: contentTypeFor(ext),
    bytes: input.bytes.length,
  };
}

export type ReadSocialResult =
  | { ok: true; bytes: Buffer; contentType: string; id: string }
  | { ok: false; status: number; error: string };

export async function readSocialAsset(rawId: string): Promise<ReadSocialResult> {
  const id = (rawId ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}\.(png|jpe?g|webp|gif|mp4)$/.test(id)) {
    return { ok: false, status: 400, error: "bad id" };
  }
  const path = join(socialDir(), id);
  try {
    const bytes = await readFile(path);
    return { ok: true, bytes, contentType: contentTypeFor(extname(id)), id };
  } catch {
    return { ok: false, status: 404, error: "not found" };
  }
}
