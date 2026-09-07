/** Push alerts: subscribe (or change what to hear about), unsubscribe, or
 *  send one test push to the calling browser. Body is JSON. */
export default async function push(event: { req: Request }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const text = await event.req.text();
    if (text.length > 6000) return json({ ok: false, error: "too big" }, 413);
    const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    const eng = await import("../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { subscribePush, unsubscribePush, testPush } = await import("../../src/lib/desk/push.server");
    const action = body.action;
    const r =
      action === "unsubscribe"
        ? await unsubscribePush(body.endpoint)
        : action === "test"
          ? await testPush(body.endpoint)
          : await subscribePush(body as Parameters<typeof subscribePush>[0]);
    return r.ok ? json(r) : json({ ok: false, error: r.error }, r.status);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
