/**
 * Kalshi websocket client (server only): one signed connection, channel
 * subscriptions with parameter variants tried in order (so an unknown
 * parameter shape on a new channel is discovered from Kalshi's own error
 * text in the logs rather than guessed), sequence-gap detection on the
 * order book, an idle watchdog, and backoff reconnects. Every parsed
 * message is handed to one handler with its receipt time.
 */
import { WebSocket } from "ws";
import { kalshiConfigured, kalshiHeaders } from "./kalshi-auth.server";

/** Kalshi's dedicated Trade API websocket host first; the shared host stays supported. */
export const KALSHI_WS_HOSTS = [
  "wss://external-api-ws.kalshi.com/trade-api/ws/v2",
  "wss://api.elections.kalshi.com/trade-api/ws/v2",
];
const WS_PATH = "/trade-api/ws/v2";
const IDLE_MS = 45_000;
const BACKOFF_MAX_MS = 60_000;
const UNAUTH_BACKOFF_MS = 300_000;

export type WsHandler = (type: string, msg: Record<string, unknown>, raw: Record<string, unknown>, t: number) => void;

type Variant = Record<string, unknown> & { __tickers?: boolean };
type ChannelSpec = { channel: string; perMarket: boolean; variants: Variant[] };

/** Subscribe parameter shapes per channel, documented shape first, in order.
 *  orderbook: use_yes_price is the documented forward-compatible convention
 *  (the book converts NO levels back internally); the bare shape is the
 *  fallback. CF Benchmarks channels take index_ids, never market tickers. */
export const CHANNELS: ChannelSpec[] = [
  { channel: "orderbook_delta", perMarket: true, variants: [{ use_yes_price: true }, {}] },
  { channel: "ticker", perMarket: true, variants: [{}] },
  { channel: "trade", perMarket: true, variants: [{}] },
  { channel: "cfbenchmarks_value", perMarket: false, variants: [{ index_ids: ["BRTI"] }, {}] },
  { channel: "cfbenchmarks_value_5hz", perMarket: false, variants: [{ index_ids: ["BRTI"] }, {}] },
];

type Sub = { sid: number; seq: number; variant: number; tickers: string[] };

export class KalshiWs {
  private ws: WebSocket | null = null;
  private hostIdx = 0;
  private cmdId = 1;
  private readonly pending = new Map<number, { channel: string; variant: number; kind: "sub" | "update" | "snapshot" }>();
  private readonly subs = new Map<string, Sub>();
  private readonly failed = new Set<string>();
  private lastUpdateAt = 0;
  private tickers: string[] = [];
  private readonly handler: WsHandler;
  private backoff = 1_000;
  private stopped = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  state: "idle" | "connecting" | "open" | "closed" | "unauthorized" = "idle";
  authed = false;
  reconnects = 0;
  gaps = 0;
  msgs = 0;
  lastMsgAt = 0;
  openedAt = 0;
  host = "";
  readonly notes: string[] = [];

  constructor(handler: WsHandler) {
    this.handler = handler;
  }

  start(): void {
    if (this.watchdog) return;
    this.connect();
    this.watchdog = setInterval(() => {
      if (this.state === "open" && Date.now() - this.lastMsgAt > IDLE_MS) {
        this.note(`idle ${IDLE_MS / 1000}s — reconnecting`);
        this.ws?.terminate();
      }
    }, 10_000);
    this.watchdog.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.ws?.terminate();
  }

  private note(s: string): void {
    this.notes.push(`${new Date().toISOString().slice(11, 19)} ${s}`);
    if (this.notes.length > 40) this.notes.shift();
    console.log(`[lab ws] ${s}`);
  }

  private connect(): void {
    if (this.stopped) return;
    this.state = "connecting";
    const url = KALSHI_WS_HOSTS[this.hostIdx % KALSHI_WS_HOSTS.length]!;
    this.host = url;
    const headers = kalshiHeaders("GET", WS_PATH) ?? {};
    this.authed = kalshiConfigured();
    const ws = new WebSocket(url, { headers, handshakeTimeout: 10_000, perMessageDeflate: false });
    this.ws = ws;
    ws.on("open", () => {
      this.state = "open";
      this.openedAt = Date.now();
      this.lastMsgAt = Date.now();
      this.backoff = 1_000;
      this.pending.clear();
      this.subs.clear();
      this.failed.clear();
      this.note(`open ${url} (${this.authed ? "signed" : "unsigned"})`);
      this.subscribeAll();
    });
    ws.on("unexpected-response", (_req, res) => {
      const code = res.statusCode ?? 0;
      this.note(`handshake rejected ${code} ${url}`);
      if (code === 401 || code === 403) {
        this.state = "unauthorized";
        this.backoff = UNAUTH_BACKOFF_MS;
      }
      ws.terminate();
    });
    ws.on("message", (data) => this.onMessage(data));
    ws.on("error", (err) => this.note(`error: ${err.message}`));
    ws.on("close", (code, reason) => {
      if (this.state !== "unauthorized") this.state = "closed";
      this.note(`closed ${code} ${reason.toString().slice(0, 120)}`);
      this.ws = null;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = this.backoff;
    this.backoff = Math.min(BACKOFF_MAX_MS, this.backoff * 2);
    this.hostIdx += 1;
    this.reconnects += 1;
    const t = setTimeout(() => this.connect(), delay);
    t.unref?.();
  }

  private send(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  /** Markets to follow. Per-market channels are re-pointed via update_subscription. */
  setTickers(list: string[]): void {
    const next = [...new Set(list.filter(Boolean))].sort();
    const cur = this.tickers;
    if (next.length === cur.length && next.every((x, i) => x === cur[i])) return;
    const added = next.filter((x) => !cur.includes(x));
    const removed = cur.filter((x) => !next.includes(x));
    this.tickers = next;
    if (this.state !== "open") return;
    for (const spec of CHANNELS) {
      const sub = this.subs.get(spec.channel);
      const usesTickers = spec.perMarket || Boolean(spec.variants[sub?.variant ?? 0]?.__tickers);
      if (!usesTickers) continue;
      if (!sub) {
        if (spec.perMarket && next.length) this.subscribeChannel(spec, 0);
        continue;
      }
      if (added.length) this.updateSub(spec.channel, sub, "add_markets", added);
      if (removed.length) this.updateSub(spec.channel, sub, "delete_markets", removed);
    }
  }

  private updateSub(channel: string, sub: Sub, action: "add_markets" | "delete_markets", tickers: string[]): void {
    const id = this.cmdId++;
    this.pending.set(id, { channel, variant: sub.variant, kind: "update" });
    // A subscription change consumes sequence numbers on the stream (a 2-step
    // jump follows every add/delete); re-anchor and don't call that a gap.
    sub.seq = 0;
    this.lastUpdateAt = Date.now();
    this.send({ id, cmd: "update_subscription", params: { sids: [sub.sid], market_tickers: tickers, action } });
  }

  private subscribeAll(): void {
    for (const spec of CHANNELS) this.subscribeChannel(spec, 0);
  }

  /** Ask for a fresh orderbook_snapshot of the followed markets without
   *  changing the subscription (documented `get_snapshot` action). The
   *  recorder keeps only top-of-book deltas, so a minute-by-minute
   *  snapshot is what lets a replay re-anchor the full book. */
  requestSnapshot(): void {
    const sub = this.subs.get("orderbook_delta");
    if (!sub || this.state !== "open" || !this.tickers.length) return;
    const id = this.cmdId++;
    this.pending.set(id, { channel: "orderbook_delta", variant: sub.variant, kind: "snapshot" });
    this.send({ id, cmd: "update_subscription", params: { sids: [sub.sid], market_tickers: this.tickers, action: "get_snapshot" } });
  }

  /** Re-request a channel (fresh snapshot after a sequence gap). */
  resubscribe(channel: string): void {
    const spec = CHANNELS.find((s) => s.channel === channel);
    if (!spec || this.state !== "open") return;
    const sub = this.subs.get(channel);
    if (sub) {
      this.send({ id: this.cmdId++, cmd: "unsubscribe", params: { sids: [sub.sid] } });
      this.subs.delete(channel);
    }
    this.subscribeChannel(spec, sub?.variant ?? 0);
  }

  private subscribeChannel(spec: ChannelSpec, variant: number): void {
    if (this.failed.has(spec.channel)) return;
    if (variant >= spec.variants.length) {
      this.failed.add(spec.channel);
      this.note(`${spec.channel}: every subscribe shape rejected — giving up until reconnect`);
      return;
    }
    const v = spec.variants[variant]!;
    if ((spec.perMarket || v.__tickers) && !this.tickers.length) return;
    const params: Record<string, unknown> = { channels: [spec.channel] };
    for (const [k, val] of Object.entries(v)) if (k !== "__tickers") params[k] = val;
    if (spec.perMarket || v.__tickers) params.market_tickers = this.tickers;
    const id = this.cmdId++;
    this.pending.set(id, { channel: spec.channel, variant, kind: "sub" });
    this.send({ id, cmd: "subscribe", params });
  }

  private onMessage(data: unknown): void {
    const t = Date.now();
    this.lastMsgAt = t;
    this.msgs += 1;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!raw || typeof raw !== "object") return;
    const type = String(raw.type ?? "");
    const id = Number(raw.id);
    const msg = raw.msg && typeof raw.msg === "object" ? (raw.msg as Record<string, unknown>) : raw;
    if (type === "subscribed") {
      const p = this.pending.get(id);
      this.pending.delete(id);
      const sid = Number(msg.sid);
      const channel = String(msg.channel ?? p?.channel ?? "");
      if (channel) this.subs.set(channel, { sid, seq: 0, variant: p?.variant ?? 0, tickers: [...this.tickers] });
      this.note(`subscribed ${channel} sid ${sid}${p ? ` (shape ${p.variant})` : ""}`);
      return;
    }
    if (type === "error") {
      const p = this.pending.get(id);
      this.pending.delete(id);
      const text = JSON.stringify(msg).slice(0, 300);
      this.note(`error id ${id}${p ? ` ${p.channel} shape ${p.variant} ${p.kind}` : ""}: ${text}`);
      if (p?.kind === "sub") {
        const spec = CHANNELS.find((s) => s.channel === p.channel);
        if (spec) this.subscribeChannel(spec, p.variant + 1);
      } else if (p?.kind === "update") {
        this.resubscribe(p.channel);
      }
      // kind "snapshot": a refused get_snapshot is only a note; the book is fine.
      return;
    }
    const sid = Number(raw.sid);
    const seq = Number(raw.seq);
    if (Number.isFinite(sid) && Number.isFinite(seq)) {
      for (const [channel, sub] of this.subs) {
        if (sub.sid !== sid) continue;
        const ack = type === "unsubscribed" || type === "ok";
        if (!ack && sub.seq && seq !== sub.seq + 1) {
          // Small jumps right after a subscription change are the change itself.
          const benign = seq - sub.seq <= 3 && t - this.lastUpdateAt < 5_000;
          if (!benign) {
            this.gaps += 1;
            this.note(`seq gap ${channel} sid ${sid}: ${sub.seq} -> ${seq}`);
            this.handler("__gap", { channel, sid, prev: sub.seq, seq }, raw, t);
          }
        }
        sub.seq = seq;
      }
    }
    if (type === "unsubscribed" || type === "ok") return;
    this.handler(type || "unknown", msg, raw, t);
  }

  /** Which subscribe shape a channel is on (0 = documented), or -1 if not subscribed. */
  variantOf(channel: string): number {
    return this.subs.get(channel)?.variant ?? -1;
  }

  summary(): Record<string, unknown> {
    return {
      state: this.state,
      host: this.host,
      signed: this.authed,
      msgs: this.msgs,
      reconnects: this.reconnects,
      seq_gaps: this.gaps,
      last_msg_age_s: this.lastMsgAt ? Math.round((Date.now() - this.lastMsgAt) / 100) / 10 : null,
      up_s: this.openedAt && this.state === "open" ? Math.round((Date.now() - this.openedAt) / 1000) : 0,
      tickers: this.tickers,
      subs: Object.fromEntries([...this.subs].map(([k, v]) => [k, { sid: v.sid, seq: v.seq, shape: v.variant }])),
      failed: [...this.failed],
      notes: this.notes.slice(-15),
    };
  }
}
