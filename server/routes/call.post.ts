/** A visitor's own paper call on the shared live window. Body: { token, name?, lean, conf? }. */
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

export default async function call(event: unknown) {
  try {
    const raw = (await bodyOf(event)) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return json(400, { ok: false, error: "bad body" });
    const eng = await import("../../src/lib/desk/server-engine");
    eng.ensureServerEngine();
    const { placeCall } = await import("../../src/lib/desk/arena.server");
    const r = await placeCall({ token: raw.token, name: raw.name, lean: raw.lean, conf: raw.conf });
    if (!r.ok) return json(r.status, { ok: false, error: r.error });
    // The room renders YOU LOCKED and the new N from this reply, no re-GET.
    const { noteLock, rackFor } = await import("../../src/lib/desk/pit.server");
    noteLock(r.call);
    const rack = await rackFor(raw.token).catch(() => null);
    return json(200, { ok: true, call: r.call, rack });
  } catch (err) {
    return json(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
