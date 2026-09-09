/** The first-screen brief: the Chair's recent decisions (GAVEL, WAIT included)
 *  and an overnight summary with BTC open→now. Public, cached 30s. Read-only. */
export default async function brief() {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30" },
    });
  try {
    const eng = await import("../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { deskBrief } = await import("../../src/lib/desk/brief.server");
    return json(await deskBrief());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
