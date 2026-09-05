/** Fast quote lane for viewers: ~150 bytes every 1.5s. as_of is the data's
 *  own timestamp; stale=true means the last upstream fetch failed — clients
 *  must freeze motion rather than animate a dead feed. */
export default async function pulse() {
  try {
    const { getPulse } = await import("../../src/lib/desk/server-engine");
    const p = getPulse();
    return new Response(JSON.stringify(p ?? { as_of: 0, stale: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ as_of: 0, stale: true, error: msg }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
