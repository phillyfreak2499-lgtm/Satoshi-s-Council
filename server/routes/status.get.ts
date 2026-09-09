/** Deep health for an external uptime monitor. 200 when the experiment is
 *  genuinely healthy; 503 (with reasons) when it is not — a wedged tick loop, no
 *  window recorded for far longer than the 15-minute cadence, a stuck ledger
 *  write, or a detected ledger hole. WAIT streaks, quiet markets and gagged
 *  seats never fail it. Kept SEPARATE from /healthz (Render's shallow liveness
 *  probe) so an external outage can't trigger a restart loop, and so an external
 *  monitor can catch what the in-process watchdog cannot — a dead process or a
 *  crash loop makes this unreachable. Alert-channel health rides in the body and
 *  never flips the status. */
export default async function status() {
  try {
    const { getHealth } = await import("../../src/lib/desk/server-engine");
    const h = await getHealth();
    return new Response(JSON.stringify(h.body, null, 2), {
      status: h.status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, reasons: [`status error: ${msg}`] }, null, 2), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
