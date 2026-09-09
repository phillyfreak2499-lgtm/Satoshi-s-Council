/** Evaluation readiness — owner only. A read-only gate that says whether enough
 *  out-of-sample data has accumulated since the TAKER v1 freeze to run the first
 *  serious evaluation, plus the exact copy-paste prompt to kick it off. Admin
 *  key required; wrong or missing key → 404 (same as /lab), so it never leaks to
 *  the public floor. Decides nothing on the desk — pure counting. */
export default async function readiness(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const { adminKeyOk } = await import("../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });
    const eng = await import("../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { readinessSnapshot } = await import("../../src/lib/desk/readiness.server");
    return json(await readinessSnapshot(eng.readinessAlerted()));
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
