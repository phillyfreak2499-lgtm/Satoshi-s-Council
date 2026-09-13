/**
 * Chamber PR 2 — pure WARDEN feed-health transition builder.
 *
 * This observes already-computed Snapshot health. It does not decide health,
 * change a gate, mute a seat, or feed anything back into the Chair.
 */
import { freshness } from "./floor-clarity.ts";
import type { SystemEventInput } from "./system-events.ts";
import type { Snapshot } from "./types.ts";

export type WardenFeedState = "LIVE" | "UNHEALTHY" | null;

export type WardenHealthObservation = {
  state: WardenFeedState;
  event: SystemEventInput | null;
};

function usableIdentity(snap: Snapshot): { ticker: string; close: number } | null {
  const ticker = String(snap.ticker ?? "").trim();
  const close = Number(snap.close_time);
  if (!ticker || ticker.includes("DEMO")) return null;
  if (!Number.isFinite(close) || close <= 0) return null;
  return { ticker, close };
}

function wardenText(kind: "alert" | "recovered", feed: "LIVE" | "STALE" | "DOWN"): string {
  if (kind === "recovered") return "Kalshi feed is live again. The feed-health alert is cleared.";
  if (feed === "DOWN") return "Kalshi feed is down. I’m flagging the feed until live data returns.";
  return "Kalshi feed is stale. Receipt freshness is compromised; I’m flagging the feed until live data returns.";
}

/**
 * Translate one observed feed-health transition into a public WARDEN event.
 *
 * Quietness rules:
 * - first observation establishes a baseline and says nothing;
 * - LIVE -> STALE/DOWN emits one alert;
 * - STALE/DOWN -> LIVE emits one recovery;
 * - STALE <-> DOWN does not chatter;
 * - unusable/demo identity neither speaks nor changes the remembered state.
 */
export function maybeWardenHealthEvent(previous: WardenFeedState, snap: Snapshot): WardenHealthObservation {
  const id = usableIdentity(snap);
  if (!id) return { state: previous, event: null };

  const f = freshness(snap);
  const current: WardenFeedState = f.feed === "LIVE" ? "LIVE" : "UNHEALTHY";
  if (previous == null) return { state: current, event: null };
  if (previous === current) return { state: current, event: null };

  const recovered = current === "LIVE";
  const event_type = recovered ? "SYSTEM_HEALTH_RECOVERED" : "SYSTEM_HEALTH_ALERT";
  const phase = recovered ? "recovered" : "alert";
  const text = wardenText(phase, f.feed);
  const source_id = `kalshi:${id.ticker}:${id.close}`;

  return {
    state: current,
    event: {
      event_key: `${event_type}:${id.ticker}:${id.close}:kalshi`,
      event_type,
      character: "WARDEN",
      occurred_at: snap.as_of,
      source_type: "health",
      source_id,
      public: true,
      payload: {
        provider: "kalshi",
        feed: f.feed,
        receipt_age_s: f.receipt_age_s,
        last_change_age_s: f.last_change_age_s,
        gap: f.gap,
        ticker: id.ticker,
        close_time: id.close,
        text,
      },
    },
  };
}
