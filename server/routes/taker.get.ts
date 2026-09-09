/** The Kalshi taker-flow shadow experiment — read-only metrics. Deliberately
 *  not linked on the floor: it is shadow, non-voting, and judged prospectively
 *  out-of-sample, so it stays off the public boards until (if ever) it earns a
 *  place. Nothing here influences the chair, the learner, COACH, or any seat. */
export default async function taker() {
  try {
    const { takerExperiment } = await import("../../src/lib/desk/taker.server");
    const report = await takerExperiment();
    return new Response(JSON.stringify(report, null, 2), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
