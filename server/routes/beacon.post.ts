/** One counted event from a page: { event }. Allowlisted names only, no
 *  body beyond that, nothing about who sent it. Always 204. */
async function bodyOf(event: unknown): Promise<unknown> {
  const ev = event as { req?: { json?: () => Promise<unknown>; text?: () => Promise<string> }; request?: { json?: () => Promise<unknown> } };
  try {
    if (typeof ev?.req?.text === "function") {
      const t = await ev.req.text();
      return t.length > 200 ? null : JSON.parse(t || "{}");
    }
    if (typeof ev?.request?.json === "function") return await ev.request.json();
    const h3 = (await import("h3").catch(() => null)) as { readBody?: (e: unknown) => Promise<unknown> } | null;
    if (h3?.readBody) return await h3.readBody(event);
  } catch {
    /* a bad beacon is not worth a word */
  }
  return null;
}

export default async function beacon(event: unknown) {
  const raw = (await bodyOf(event)) as { event?: unknown } | null;
  try {
    const { hit, isHitEvent } = await import("../../src/lib/desk/hits.server");
    if (raw && isHitEvent(raw.event)) hit(raw.event);
  } catch {
    /* counters never fail a request */
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
