import { socialUploadConfigured, socialUploadKeyOk, saveSocialAsset } from "../../../src/lib/desk/social-media.server";

/** Upload a social asset (PNG/JPG/WebP/GIF/MP4) to the Render disk.
 *  Auth: SOCIAL_UPLOAD_KEY or DESK_ADMIN_KEY via Authorization: Bearer, x-desk-key, or JSON `key`.
 *  Body: raw image bytes (Content-Type set) OR JSON { key?, id?, filename?, bytes_base64 }.
 *  Returns { ok, url, id, bytes, content_type } — pass `url` to OpenTweet media_urls. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function keyFrom(req: Request, bodyKey?: unknown): unknown {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const hdr = req.headers.get("x-desk-key") ?? req.headers.get("x-social-upload-key");
  if (hdr) return hdr.trim();
  return bodyKey;
}

function publicBase(req: Request): string {
  const env = process.env.PUBLIC_SITE_URL?.trim()?.replace(/\/$/, "");
  if (env) return env;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "satoshiscouncil.com";
  return `${proto}://${host}`;
}

export default async function socialUpload(event: { req: Request }) {
  try {
    if (!socialUploadConfigured()) {
      return json(503, { ok: false, error: "SOCIAL_UPLOAD_KEY or DESK_ADMIN_KEY not set" });
    }
    const req = event.req;
    const ct = (req.headers.get("content-type") ?? "").toLowerCase();
    let bytes: Uint8Array | null = null;
    let contentType: string | null = ct.split(";")[0].trim() || null;
    let id: string | null = null;
    let filename: string | null = null;
    let bodyKey: unknown;

    if (ct.includes("application/json")) {
      const text = await req.text();
      if (text.length > 12 * 1024 * 1024) return json(413, { ok: false, error: "too big" });
      const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
      bodyKey = body.key;
      id = typeof body.id === "string" ? body.id : null;
      filename = typeof body.filename === "string" ? body.filename : null;
      const b64 = typeof body.bytes_base64 === "string" ? body.bytes_base64 : null;
      if (!b64) return json(400, { ok: false, error: "bytes_base64 required" });
      bytes = Buffer.from(b64, "base64");
      if (typeof body.content_type === "string") contentType = body.content_type;
    } else {
      const url = new URL(req.url);
      id = url.searchParams.get("id");
      filename = url.searchParams.get("filename") ?? url.searchParams.get("name");
      const ab = await req.arrayBuffer();
      bytes = new Uint8Array(ab);
    }

    if (!socialUploadKeyOk(keyFrom(req, bodyKey))) {
      return json(401, { ok: false, error: "upload key rejected" });
    }
    if (!bytes) return json(400, { ok: false, error: "empty body" });

    const saved = await saveSocialAsset({ bytes, contentType, id, filename });
    if (!saved.ok) return json(saved.status, { ok: false, error: saved.error });
    const url = `${publicBase(req)}${saved.urlPath}`;
    return json(200, {
      ok: true,
      id: saved.id,
      url,
      path: saved.urlPath,
      bytes: saved.bytes,
      content_type: saved.contentType,
    });
  } catch (err) {
    return json(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
