/**
 * QUIET_CALL_LEDGER_V1 research report — owner-only, header-authenticated.
 * AUTHORITY: NONE. Reads the quiet-call book and its table; votes nothing, books
 * nothing, promotes nothing. Header auth only (`x-desk-admin`): a key in the URL
 * is never read. Wrong or missing key → 404. Not linked from any public page and
 * not in the sitemap.
 */
export default async function quietCallsResearch(event: { req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const { adminKeyOk } = await import("../../../src/lib/desk/admin.server");
    const key = event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const { quietLedgerReport } = await import("../../../src/lib/desk/server-engine");
    return json(await quietLedgerReport());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
