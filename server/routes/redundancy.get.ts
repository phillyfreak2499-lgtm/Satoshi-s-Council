/** The redundancy study, admin-key only: which seats agree with each other, which
 *  ever change the council's answer, and whether the council is more right with
 *  them or without. In-sample by construction — read the caveat before any row.
 *  Read-only, non-voting; it mutes and reweights nothing. Wrong or missing key → 404. */
export default async function redundancy(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const { adminKeyOk } = await import("../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const { redundancyStudy } = await import("../../src/lib/desk/redundancy.server");
    return json(await redundancyStudy());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
