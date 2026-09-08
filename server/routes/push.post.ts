import { adminKeyOk } from "../../src/lib/desk/admin.server";

/** Push alerts: subscribe (or change what to hear about), unsubscribe, send
 *  one test push to the calling browser, or — with the admin key — flag this
 *  browser as the owner's for the desk watchdog. Body is JSON. */
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
    const { subscribePush, unsubscribePush, testPush, setOwnerPush } = await import("../../src/lib/desk/push.server");
    const action = body.action;
    if (action === "owner") {
      if (!process.env.DESK_ADMIN_KEY) return json({ ok: false, error: "admin key not configured on the server" }, 503);
      if (!adminKeyOk(body.key)) return json({ ok: false, error: "admin key rejected" }, 401);
    }
    const r =
      action === "unsubscribe"
        ? await unsubscribePush(body.endpoint)
        : action === "test"
          ? await testPush(body.endpoint)
          : action === "owner"
            ? await setOwnerPush(body.endpoint, body.on === true)
            : await subscribePush(body as Parameters<typeof subscribePush>[0]);
    return r.ok ? json(r) : json({ ok: false, error: r.error }, r.status);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
