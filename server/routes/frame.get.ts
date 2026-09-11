/** Shared-brain viewer feed: the server desk's current frame as plain GET. */
import { liqAgeS } from "../../src/lib/desk/liq-pack";

export default async function frame() {
  try {
    const { getServerFrame } = await import("../../src/lib/desk/server-engine");
    const f = await getServerFrame();
    const snap = f && typeof f === "object" ? (f as { snap?: Record<string, unknown> }).snap : null;
    if (snap && typeof snap === "object") {
      const last = Number(snap.liq_last_t ?? 0);
      const asOf = Number(snap.as_of ?? 0);
      snap.liq_last_t = last;
      snap.liq_age_s = liqAgeS(last, asOf);
    }
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
