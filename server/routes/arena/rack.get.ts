/** THE PIT's rack: the live window, how many locked, this token's lock, and
 *  — only for a token that has locked this window — the split and the
 *  average paper lock. Tiny; polled every few seconds by the room. */
export default async function rack(event: { url: URL }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const eng = await import("../../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { rackFor } = await import("../../../src/lib/desk/pit.server");
    return json(await rackFor(event.url.searchParams.get("token")));
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
