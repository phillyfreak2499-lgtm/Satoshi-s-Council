/**
 * Research factory report, admin-key only. Read only: job counts by status,
 * recent failures, governor health, and the latest derived reports
 * (?kind=matched_grade|evidence_safety|choke_attribution|pockets|
 * counterfactual_gates|lifecycle|utilization|daily_digest&report_key=...).
 * Nothing here votes, books, promotes, or changes production. Wrong or
 * missing key → 404. Not linked from any public page.
 */
export default async function researchFactory(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
  try {
    const { adminKeyOk } = await import("../../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const { researchFactoryReport } = await import("../../../src/lib/desk/research-factory.server");
    const kind = event.url.searchParams.get("kind") ?? undefined;
    const reportKey = event.url.searchParams.get("report_key") ?? "latest";
    return json(await researchFactoryReport(kind, reportKey));
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
