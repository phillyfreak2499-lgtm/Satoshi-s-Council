/** Hide one Arena callsign: the player and every paper lock stay, the public
 *  name becomes a neutral paper label. Admin key only. Body: { key, name }.
 *  The name is never logged or echoed back. */
import { adminKeyOk } from "../../../src/lib/desk/admin.server";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function bodyOf(event: unknown): Promise<unknown> {
  const ev = event as { req?: { json?: () => Promise<unknown> }; request?: { json?: () => Promise<unknown> } };
  try {
    if (typeof ev?.req?.json === "function") return await ev.req.json();
    if (typeof ev?.request?.json === "function") return await ev.request.json();
    const h3 = (await import("h3").catch(() => null)) as { readBody?: (e: unknown) => Promise<unknown> } | null;
    if (h3?.readBody) return await h3.readBody(event);
  } catch {
    /* fall through */
  }
  return null;
}

export default async function hide(event: unknown) {
  try {
    const raw = (await bodyOf(event)) as { key?: unknown; name?: unknown } | null;
    if (!process.env.DESK_ADMIN_KEY) return json(503, { ok: false, error: "admin key not configured on the server" });
    if (!adminKeyOk(raw?.key)) return json(401, { ok: false, error: "admin key rejected" });
    const { hideCallsign } = await import("../../../src/lib/desk/arena.server");
    const { resetPitCaches } = await import("../../../src/lib/desk/pit.server");
    const r = await hideCallsign(raw?.name);
    if (!r.ok) return json(r.status, { ok: false, error: r.error });
    resetPitCaches();
    return json(200, { ok: true, hidden: r.hidden });
  } catch {
    return json(500, { ok: false, error: "could not hide that callsign" });
  }
}
