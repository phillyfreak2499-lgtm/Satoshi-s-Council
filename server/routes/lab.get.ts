/** The lab's instrument panel, admin-key only: feed state, BRTI, the
 *  settlement-model fair value, the local book, the stale-quote study,
 *  settlement receipts and basis. `?tail=1` adds raw message samples per
 *  type (schema discovery for new channels). Wrong or missing key → 404. */
export default async function lab(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const { adminKeyOk } = await import("../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const eng = await import("../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { labSummary } = await import("../../src/lib/desk/lab.server");
    return json(labSummary({ samples: event.url.searchParams.get("tail") === "1" }));
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
