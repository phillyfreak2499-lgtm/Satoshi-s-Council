import { adminKeyOk } from "../../../src/lib/desk/admin.server";

/** Owner-only Discord release flag (status/release/hold). Independent of web push's
 * per-commit verification. No engine start, booking, webhook send or outage action. */
export default async function discordRelease(event: { req: Request }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const text = await event.req.text();
    if (text.length > 2000) return json({ ok: false, error: "too big" }, 413);
    const body = JSON.parse(text || "{}") as Record<string, unknown>;
    if (!process.env.DESK_ADMIN_KEY)
      return json({ ok: false, error: "admin key not configured" }, 503);
    if (!adminKeyOk(body.key)) return json({ ok: false, error: "admin key rejected" }, 401);
    const { getSql } = await import("../../../src/lib/db");
    const { discordReleaseControl } = await import("../../../src/lib/desk/discord-release.server");
    const result = await discordReleaseControl(await getSql(), { action: body.action });
    return json(result, result.ok ? 200 : result.status);
  } catch {
    return json({ ok: false, error: "discord release control failed; state unchanged or held" }, 503);
  }
}
