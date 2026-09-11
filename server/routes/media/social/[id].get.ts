import { readSocialAsset } from "../../../../src/lib/desk/social-media.server";

/** Public GET for a stored social asset: /media/social/{id}.png etc. */
export default async function socialGet(event: { context?: { params?: Record<string, string> }; url?: URL; req?: Request }) {
  try {
    const fromParams = event.context?.params?.id ?? event.context?.params?.name;
    const fromUrl = event.url?.pathname?.split("/").pop() ?? new URL(event.req?.url ?? "http://local/").pathname.split("/").pop();
    const raw = (fromParams || fromUrl || "").trim();
    const got = await readSocialAsset(raw);
    if (!got.ok) {
      return new Response(got.error, { status: got.status, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return new Response(new Uint8Array(got.bytes), {
      status: 200,
      headers: {
        "content-type": got.contentType,
        "content-length": String(got.bytes.length),
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
