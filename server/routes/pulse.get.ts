/**
 * Fast viewer lane. The pulse is deliberately separate from the Chair's 4s
 * research frame: it makes the displayed spot/book current without changing a
 * single vote or call. Quotes come from the current ticker's orderbook, never
 * the slower market-list summary.
 */
export default async function pulse() {
  try {
    const [{ getServerFrame }, { fetchFastPulse }] = await Promise.all([
      import("../../src/lib/desk/server-engine"),
      import("../../src/lib/desk/fast-pulse.server"),
    ]);
    const frame = await getServerFrame();
    const snap = frame.snap;
    if (!snap) {
      return new Response(JSON.stringify({ as_of: 0, stale: true }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    const p = await fetchFastPulse(snap);
    return new Response(JSON.stringify(p), {
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
