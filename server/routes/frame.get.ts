/** Shared-brain viewer feed: the server desk's current frame as plain GET. */
export default async function frame() {
  try {
    const { getServerFrame } = await import("../../src/lib/desk/server-engine");
    const f = await getServerFrame();
    return new Response(JSON.stringify(f), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
