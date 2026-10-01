/**
 * Research reports admin page, admin-key only. One read-only HTML page over the
 * research factory's health, the research summary, experiment lifecycle and
 * evidence safety, the instrument tests and every stored report. Static HTML:
 * no script, no external resource, and the key is never written into the
 * page. Nothing here votes, books, promotes, or changes production. Wrong or
 * missing key → 404. Not linked from any public page.
 */
export default async function researchReports(event: { url: URL; req: { headers: Headers } }) {
  try {
    const { adminKeyOk } = await import("../../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const { researchReportsPage } = await import("../../../src/lib/desk/research-factory.server");
    return new Response(await researchReportsPage(), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex, nofollow",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
}
