import { adminKeyOk } from "../../../src/lib/desk/admin.server";

/** Owner-only verification/hold/release. No engine start, booking or outage action. */
export default async function alertVerification(event: { req: Request }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const text = await event.req.text();
    if (text.length > 6000) return json({ ok: false, error: "too big" }, 413);
    const body = JSON.parse(text || "{}") as Record<string, unknown>;
    if (!process.env.DESK_ADMIN_KEY)
      return json({ ok: false, error: "admin key not configured" }, 503);
    if (!adminKeyOk(body.key)) return json({ ok: false, error: "admin key rejected" }, 401);
    const { ownerAlertVerification } = await import("../../../src/lib/desk/push.server");
    const result = await ownerAlertVerification(body);
    return json(result, result.ok ? 200 : result.status);
  } catch {
    return json(
      {
        ok: false,
        error: "verification failed; rollout remains held unless already explicitly released",
      },
      503,
    );
  }
}
