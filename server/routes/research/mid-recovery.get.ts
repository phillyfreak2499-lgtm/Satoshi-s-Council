/**
 * MID_RECOVERY_V1_INACTIVE research report, admin-key only. No decision
 * authority: it reads the experiment's own shadow receipts and prints the
 * window flow, the bottleneck funnel, the quality statistics, the NULL_FAV_80
 * comparison and the seat/card/family breakdown. Nothing here votes, books,
 * promotes, or places an order — the desk is paper only. Wrong or missing
 * key → 404. Not linked from any public page.
 */
export default async function midRecoveryResearch(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
  try {
    const { adminKeyOk } = await import("../../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const { midRecoveryReport } = await import("../../../src/lib/desk/shadow-lab-mid-recovery.server");
    const report = await midRecoveryReport();
    return json({ ...report, authority: { promotes_nothing: true, books_nothing: true, paper_only: true, historical_replay: "not run: the recovery path needs full producer snapshots that are not stored" } });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
