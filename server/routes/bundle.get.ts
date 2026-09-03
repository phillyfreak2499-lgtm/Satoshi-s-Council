/** Full live scrape as plain GET — Cloudflare was 403ing /_serverFn. */
export default async function bundle() {
  try {
    const { loadBundle } = await import("../../src/lib/desk/server-feeds");
    const b = await loadBundle();
    return new Response(JSON.stringify(b), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
}
