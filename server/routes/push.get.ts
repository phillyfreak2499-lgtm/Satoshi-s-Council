/** Push alerts: the desk's public VAPID key, and with ?endpoint= what that
 *  browser has asked to hear about. Public; nothing here writes. */
export default async function push(event: { url: URL }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const eng = await import("../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { pushKeys, pushPrefsFor } = await import("../../src/lib/desk/push.server");
    const k = await pushKeys();
    const endpoint = event.url.searchParams.get("endpoint");
    const prefs = endpoint ? await pushPrefsFor(endpoint) : null;
    return json({ key: k.publicKey, prefs });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
