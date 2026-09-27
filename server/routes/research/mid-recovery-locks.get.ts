/**
 * MID_RECOVERY_LOCKS_V1_INACTIVE research report, admin-key only. No decision
 * authority: it reads ONLY this experiment's own shadow receipts (experiment =
 * MID_RECOVERY_LOCKS_V1_INACTIVE — never MID_RECOVERY_V1_INACTIVE rows) and
 * prints per-arm funnels, quality, the NULL_FAV_80 and CONTROL comparisons and
 * the promotion-eligibility flags. Nothing here votes, books, promotes, or
 * places an order. Wrong or missing key → 404. Not linked from any public page.
 */
export default async function midRecoveryLocksResearch(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
  try {
    const { adminKeyOk } = await import("../../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const { midRecoveryLocksReport } = await import("../../../src/lib/desk/shadow-lab-mid-recovery-locks.server");
    const report = await midRecoveryLocksReport();
    return json({ ...report, authority: { production_authority: "NONE", promotes_nothing: true, books_nothing: true, paper_only: true, simulated_only: true } });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
