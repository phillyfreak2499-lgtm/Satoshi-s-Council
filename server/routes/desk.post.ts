import { adminKeyOk } from "../../src/lib/desk/admin.server";

/** Desk controls for the shared brain. Admin key only. */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function bodyOf(event: unknown): Promise<unknown> {
  const ev = event as { req?: { json?: () => Promise<unknown> }; request?: { json?: () => Promise<unknown> } };
  if (typeof ev?.req?.json === "function") return ev.req.json();
  if (typeof ev?.request?.json === "function") return ev.request.json();
  const h3 = (await import("h3").catch(() => null)) as { readBody?: (e: unknown) => Promise<unknown> } | null;
  if (h3?.readBody) return h3.readBody(event);
  return null;
}

export default async function desk(event: unknown) {
  try {
    const raw = (await bodyOf(event)) as { key?: string; op?: string } | null;
    if (!raw || typeof raw !== "object") return json(400, { ok: false, error: "bad body" });
    if (!process.env.DESK_ADMIN_KEY) {
      return json(503, { ok: false, error: "admin key not configured on the server" });
    }
    if (!adminKeyOk(raw.key)) return json(401, { ok: false, error: "admin key rejected" });
    const { applyDeskOp } = await import("../../src/lib/desk/server-engine");
    const { key: _key, ...op } = raw;
    await applyDeskOp(op as Parameters<typeof applyDeskOp>[0]);
    return json(200, { ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(500, { ok: false, error: msg });
  }
}
