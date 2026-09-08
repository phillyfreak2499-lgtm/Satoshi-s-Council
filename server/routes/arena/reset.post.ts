/** Clear the Arena: every callsign and every paper lock. Admin key only.
 *  Body: { key }. Boards start over; push subscriptions are kept. */
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

export default async function reset(event: unknown) {
  try {
    const raw = (await bodyOf(event)) as { key?: unknown } | null;
    if (!process.env.DESK_ADMIN_KEY) return json(503, { ok: false, error: "admin key not configured on the server" });
    if (!adminKeyOk(raw?.key)) return json(401, { ok: false, error: "admin key rejected" });
    const { resetArena } = await import("../../../src/lib/desk/arena.server");
    const { resetPitCaches } = await import("../../../src/lib/desk/pit.server");
    const r = await resetArena();
    resetPitCaches();
    return json(200, { ok: true, ...r });
  } catch (err) {
    return json(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
