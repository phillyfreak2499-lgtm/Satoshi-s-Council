import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db";
import { paperAlert, readAlert } from "./alert-copy";
import type { PushDeliveryOutcome } from "./push-receipts";

type OwnerSub = {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  token: string | null;
};
type Delivery = {
  outcome: PushDeliveryOutcome;
  statusCode: number | null;
  errorCode: string | null;
};
type Payload = {
  title: string;
  body: string;
  tag: string;
  url: string;
  icon: string;
  badge: string;
};
export type OwnerVerificationInput = {
  action?: unknown;
  endpoint?: unknown;
  verification_id?: unknown;
  confirm_test_fixtures?: unknown;
  confirm_device_display?: unknown;
};
const VALID_BUILD = /^[a-f0-9]{40}$/;
const MAX_FAILS = 8;
export function ownerFingerprint(sub: OwnerSub): string {
  return createHash("sha256")
    .update(JSON.stringify([sub.endpoint, sub.p256dh, sub.auth]))
    .digest("hex");
}

/** No row, no build identity, SQL failure, rekey or lost owner eligibility => held.
 * A release is scoped to the deployed commit; restart preserves that build's release. */
export async function rolloutReady(db: Sql, build: string): Promise<boolean> {
  if (!VALID_BUILD.test(build)) return false;
  const rows = await db<OwnerSub & { key_fingerprint: string }>`
    select s.id,s.endpoint,s.p256dh,s.auth,s.token,a.key_fingerprint
    from desk_alert_rollout r join desk_alert_verification_attempts a on a.id=r.verification_id
    join desk_push_subs s on s.id=a.subscription_id
    where r.build_sha=${build} and a.build_sha=${build} and r.device_display_confirmed
      and s.owner and s.fails < ${MAX_FAILS}
      and (select count(*) from desk_alert_verification_receipts v
           where v.verification_id=a.id and v.outcome='accepted')=2
  `;
  return rows.some((row) => ownerFingerprint(row) === row.key_fingerprint);
}

/** Authentication is at the route; this independently requires an existing owner
 * subscription. Tests use exact approved copy and isolated receipts, never fills,
 * subscriber fanout, owner readiness evidence or subscription bookkeeping. */
export async function ownerVerification(
  db: Sql,
  send: (sub: OwnerSub, payload: Payload) => Promise<Delivery>,
  build: string,
  input: OwnerVerificationInput,
) {
  const fail = (error: string, status = 400) => ({ ok: false as const, error, status });
  if (!VALID_BUILD.test(build))
    return fail("deployed build identity unavailable; rollout remains held", 503);
  if (typeof input.endpoint !== "string" || input.endpoint.length > 1500)
    return fail("owner endpoint required");
  const rows = await db<OwnerSub>`select id,endpoint,p256dh,auth,token from desk_push_subs
    where endpoint=${input.endpoint} and owner and fails < ${MAX_FAILS}`;
  const sub = rows[0];
  if (!sub) return fail("an eligible owner subscription is required", 403);
  if (input.action === "status")
    return { ok: true as const, build_sha: build, held: !(await rolloutReady(db, build)) };
  if (input.action === "hold") {
    await db`delete from desk_alert_rollout where build_sha=${build}`;
    return { ok: true as const, build_sha: build, held: true };
  }
  if (input.action === "verify") {
    if (input.confirm_test_fixtures !== true)
      return fail(
        "acknowledge that both notifications are test fixtures, not actual positions or reads",
      );
    // Testing (including retesting) always closes the production alert gate first.
    await db`delete from desk_alert_rollout where build_sha=${build}`;
    const id = randomUUID();
    const close = Date.now() + 5 * 60000;
    await db`insert into desk_alert_verification_attempts(id,build_sha,subscription_id,key_fingerprint,expires_at)
      values(${id},${build},${sub.id},${ownerFingerprint(sub)},${new Date(Date.now() + 15 * 60000)})`;
    const tiers = [
      { tier: "paper-fill", payload: paperAlert("UP", 83, close) },
      {
        tier: "directional-read",
        payload: readAlert("DOWN", "75¢ ask is below the 80¢ paper floor", close),
      },
    ];
    const results = [];
    for (const { tier, payload } of tiers) {
      const at = new Date();
      let result: Delivery;
      try {
        result = await send(sub, { ...payload, tag: `verify-${id}-${tier}`, url: "/desk" });
      } catch {
        result = { outcome: "failed", statusCode: null, errorCode: "transport_error" };
      }
      await db`insert into desk_alert_verification_receipts(verification_id,tier,outcome,provider_status,error_code,attempted_at)
        values(${id},${tier},${result.outcome},${result.statusCode},${result.errorCode?.slice(0, 120) ?? null},${at})`;
      results.push({ tier, outcome: result.outcome });
    }
    return { ok: true as const, build_sha: build, held: true, verification_id: id, tiers: results };
  }
  if (input.action === "release") {
    if (input.confirm_device_display !== true)
      return fail(
        "confirm seeing both exact titles, messages and distinct badges on this owner device",
      );
    if (typeof input.verification_id !== "string") return fail("verification id required");
    const attempts = await db<{
      key_fingerprint: string;
    }>`select key_fingerprint from desk_alert_verification_attempts a
      where a.id=${input.verification_id} and a.build_sha=${build} and a.subscription_id=${sub.id}
        and a.expires_at > now()
        and (select count(*) from desk_alert_verification_receipts v
             where v.verification_id=a.id and v.outcome='accepted')=2`;
    if (!attempts[0] || attempts[0].key_fingerprint !== ownerFingerprint(sub))
      return fail(
        "fresh two-tier acceptance for this build and unchanged owner device is required",
        409,
      );
    await db`insert into desk_alert_rollout(build_sha,verification_id,device_display_confirmed)
      values(${build},${input.verification_id},true) on conflict(build_sha) do update
      set verification_id=excluded.verification_id,device_display_confirmed=true,released_at=now()`;
    return { ok: true as const, build_sha: build, held: !(await rolloutReady(db, build)) };
  }
  return fail("unknown verification action");
}
