import assert from "node:assert/strict";
import { test } from "node:test";
import { maybeWardenHealthEvent, type WardenFeedState } from "./chamber-health.ts";
import { statementFromEvent } from "./chamber-reactions.ts";
import type { PublicSystemEvent } from "./system-events.ts";
import { validateSystemEvent } from "./system-events.ts";
import type { Snapshot } from "./types.ts";

const T0 = Date.parse("2026-09-13T13:15:00Z");
const TICKER = "KXBTC15M-26SEP130930-30";
const CLOSE = Date.parse("2026-09-13T13:30:00Z");

function snap(feed: "LIVE" | "STALE" | "DOWN", over: Partial<Snapshot> = {}): Snapshot {
  return {
    as_of: T0,
    ticker: TICKER,
    close_time: CLOSE,
    quote_age_s: feed === "LIVE" ? 3 : 40,
    health: { kalshi: feed },
    obs: {
      last_ok_ts: feed === "LIVE" ? T0 - 2_000 : T0 - 40_000,
      gap: feed === "LIVE" ? "ok" : "held",
    },
    ...over,
  } as unknown as Snapshot;
}

function asPublic(input: ReturnType<typeof maybeWardenHealthEvent>["event"]): PublicSystemEvent {
  assert.ok(input);
  const ev = validateSystemEvent(input!);
  return {
    event_key: ev.event_key,
    event_type: ev.event_type,
    character: ev.character,
    occurred_at: ev.occurred_at.toISOString(),
    source_type: ev.source_type,
    source_id: ev.source_id,
    payload: ev.payload,
  };
}

test("WARDEN first observation establishes baseline without speaking", () => {
  const a = maybeWardenHealthEvent(null, snap("LIVE"));
  assert.equal(a.state, "LIVE");
  assert.equal(a.event, null);
  const b = maybeWardenHealthEvent(null, snap("STALE"));
  assert.equal(b.state, "UNHEALTHY");
  assert.equal(b.event, null);
});

test("WARDEN emits one public alert on LIVE -> unhealthy", () => {
  const out = maybeWardenHealthEvent("LIVE", snap("STALE"));
  assert.equal(out.state, "UNHEALTHY");
  assert.ok(out.event);
  assert.equal(out.event!.event_type, "SYSTEM_HEALTH_ALERT");
  assert.equal(out.event!.character, "WARDEN");
  assert.equal(out.event!.public, true);
  assert.equal(out.event!.source_type, "health");
  assert.equal(out.event!.event_key, `SYSTEM_HEALTH_ALERT:${TICKER}:${CLOSE}:kalshi`);
  assert.equal((out.event!.payload as Record<string, unknown>).feed, "STALE");
  validateSystemEvent(out.event!);
});

test("WARDEN DOWN alert uses deterministic down wording", () => {
  const out = maybeWardenHealthEvent("LIVE", snap("DOWN"));
  assert.ok(out.event);
  assert.match(String((out.event!.payload as Record<string, unknown>).text), /feed is down/i);
});

test("WARDEN does not chatter while unhealthy or on STALE <-> DOWN", () => {
  const stale = maybeWardenHealthEvent("UNHEALTHY", snap("STALE"));
  assert.equal(stale.event, null);
  const down = maybeWardenHealthEvent("UNHEALTHY", snap("DOWN"));
  assert.equal(down.event, null);
  assert.equal(down.state, "UNHEALTHY");
});

test("WARDEN emits recovery on unhealthy -> LIVE", () => {
  const out = maybeWardenHealthEvent("UNHEALTHY", snap("LIVE"));
  assert.equal(out.state, "LIVE");
  assert.ok(out.event);
  assert.equal(out.event!.event_type, "SYSTEM_HEALTH_RECOVERED");
  assert.equal(out.event!.character, "WARDEN");
  assert.equal(out.event!.event_key, `SYSTEM_HEALTH_RECOVERED:${TICKER}:${CLOSE}:kalshi`);
  assert.match(String((out.event!.payload as Record<string, unknown>).text), /live again/i);
});

test("WARDEN mapper produces only stored evidence-backed text", () => {
  const alert = maybeWardenHealthEvent("LIVE", snap("STALE"));
  const stmt = statementFromEvent(asPublic(alert.event));
  assert.ok(stmt);
  assert.equal(stmt!.speaker, "WARDEN");
  assert.equal(stmt!.text, (alert.event!.payload as Record<string, unknown>).text);
  assert.equal(stmt!.evidence.kind, "system-health");
  assert.equal(stmt!.evidence.feed, "STALE");
  assert.equal(stmt!.evidence.ticker, TICKER);
  assert.equal(stmt!.evidence.close_time, CLOSE);
  assert.equal(stmt!.evidence.receipt_age_s, 40);
  assert.equal(stmt!.evidence.gap, "held");
});

test("wrong character or empty stored text stays silent", () => {
  const alert = asPublic(maybeWardenHealthEvent("LIVE", snap("STALE")).event);
  assert.equal(statementFromEvent({ ...alert, character: "SATOSHI" }), null);
  assert.equal(statementFromEvent({ ...alert, payload: { ...alert.payload, text: "" } }), null);
});

test("unusable/demo identity neither speaks nor changes remembered state", () => {
  for (const bad of [
    snap("DOWN", { ticker: "" }),
    snap("DOWN", { ticker: "DEMO" }),
    snap("DOWN", { ticker: "KXBTC15M-DEMO-00" }),
    snap("DOWN", { close_time: 0 }),
    snap("DOWN", { close_time: Number.NaN }),
  ]) {
    const out = maybeWardenHealthEvent("LIVE" as WardenFeedState, bad);
    assert.equal(out.state, "LIVE");
    assert.equal(out.event, null);
  }
});
