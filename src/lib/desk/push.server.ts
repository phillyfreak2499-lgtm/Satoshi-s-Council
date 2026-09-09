/**
 * Push alerts (server only). A browser that opted in gets a web push when
 * the chair books a call and, if it asked, when a window settles — with its
 * own Arena result on the line when it made a call. The VAPID keys are
 * generated once and kept in Postgres, so subscriptions survive restarts.
 * One push per event per window by construction: the chair books at most
 * once a window and a window grades once.
 */
import webpush from "web-push";
import { settleWanted, type WatchdogPayload } from "./push-rules";

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

const SUBJECT = process.env.PUSH_SUBJECT || "https://satoshiscouncil.com";
const TOKEN_RE = /^[A-Za-z0-9\-_]{16,64}$/;
const ICON = "/__grok/icon-180.png";
const MAX_FAILS = 8;
const CONCURRENCY = 6;

type Keys = { publicKey: string; privateKey: string };
let keys: Keys | null = null;
let keysInflight: Promise<Keys> | null = null;

export async function pushKeys(): Promise<Keys> {
  if (keys) return keys;
  if (!keysInflight) {
    keysInflight = (async () => {
      const db = await sql();
      const read = async () => {
        const rows = await db<{ public_key: string; private_key: string }>`
          select public_key, private_key from desk_push_keys where id = 'vapid'
        `;
        return rows[0] ? { publicKey: rows[0].public_key, privateKey: rows[0].private_key } : null;
      };
      let k = await read();
      if (!k) {
        const fresh = webpush.generateVAPIDKeys();
        await db`
          insert into desk_push_keys (id, public_key, private_key)
          values ('vapid', ${fresh.publicKey}, ${fresh.privateKey})
          on conflict (id) do nothing
        `;
        k = (await read()) ?? fresh;
      }
      keys = k;
      return k;
    })().finally(() => {
      keysInflight = null;
    });
  }
  return keysInflight;
}

export type PushPrefs = { on_call: boolean; on_settle: boolean; owner: boolean };
export type SubInput = {
  subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  endpoint?: unknown;
  token?: unknown;
  on_call?: unknown;
  on_settle?: unknown;
  ua?: unknown;
};
export type PushResult = { ok: true; prefs: PushPrefs } | { ok: false; error: string; status: number };

function cleanEndpoint(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 1500) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return null;
    return v;
  } catch {
    return null;
  }
}

function cleanKey(v: unknown, max = 200): string | null {
  return typeof v === "string" && /^[A-Za-z0-9\-_=]{8,}$/.test(v) && v.length <= max ? v : null;
}

export async function subscribePush(input: SubInput): Promise<PushResult> {
  const endpoint = cleanEndpoint(input.subscription?.endpoint ?? input.endpoint);
  const p256dh = cleanKey(input.subscription?.keys?.p256dh);
  const auth = cleanKey(input.subscription?.keys?.auth, 64);
  if (!endpoint || !p256dh || !auth) return { ok: false, error: "that subscription is missing its keys", status: 400 };
  const token = typeof input.token === "string" && TOKEN_RE.test(input.token) ? input.token : null;
  const on_call = input.on_call !== false;
  const on_settle = input.on_settle === true;
  const ua = typeof input.ua === "string" ? input.ua.slice(0, 200) : null;
  const db = await sql();
  const rows = await db<{ owner: boolean }>`
    insert into desk_push_subs (endpoint, p256dh, auth, token, on_call, on_settle, ua)
    values (${endpoint}, ${p256dh}, ${auth}, ${token}, ${on_call}, ${on_settle}, ${ua})
    on conflict (endpoint) do update set
      p256dh = excluded.p256dh, auth = excluded.auth, token = coalesce(excluded.token, desk_push_subs.token),
      on_call = excluded.on_call, on_settle = excluded.on_settle, ua = excluded.ua,
      last_seen = now(), fails = 0
    returning owner
  `;
  return { ok: true, prefs: { on_call, on_settle, owner: rows[0]?.owner === true } };
}

export async function unsubscribePush(endpointRaw: unknown): Promise<PushResult> {
  const endpoint = cleanEndpoint(endpointRaw);
  if (!endpoint) return { ok: false, error: "no endpoint", status: 400 };
  const db = await sql();
  await db`delete from desk_push_subs where endpoint = ${endpoint}`;
  return { ok: true, prefs: { on_call: false, on_settle: false, owner: false } };
}

/** The owner flag: only the route that checked the admin key calls this. */
export async function setOwnerPush(endpointRaw: unknown, on: boolean): Promise<PushResult> {
  const endpoint = cleanEndpoint(endpointRaw);
  if (!endpoint) return { ok: false, error: "no endpoint", status: 400 };
  const db = await sql();
  const rows = await db<PushPrefs>`
    update desk_push_subs set owner = ${on}, last_seen = now() where endpoint = ${endpoint}
    returning on_call, on_settle, owner
  `;
  if (!rows[0]) return { ok: false, error: "turn alerts on in this browser first", status: 404 };
  return { ok: true, prefs: rows[0] };
}

export async function pushPrefsFor(endpointRaw: unknown): Promise<PushPrefs | null> {
  const endpoint = cleanEndpoint(endpointRaw);
  if (!endpoint) return null;
  const db = await sql();
  const rows = await db<PushPrefs>`select on_call, on_settle, owner from desk_push_subs where endpoint = ${endpoint}`;
  return rows[0] ?? null;
}

export type PushPayload = { title: string; body: string; tag: string; url?: string; icon?: string };

type SubRow = { id: number; endpoint: string; p256dh: string; auth: string; token: string | null };

async function sendOne(sub: SubRow, payload: PushPayload): Promise<"sent" | "gone" | "failed"> {
  const k = await pushKeys();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ icon: ICON, url: "/", ...payload }),
      { vapidDetails: { subject: SUBJECT, publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 900, urgency: "high" },
    );
    return "sent";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode ?? 0;
    return status === 404 || status === 410 ? "gone" : "failed";
  }
}

/** Send to every subscriber the picker returns a payload for. Never throws. */
async function fanout(subs: SubRow[], pick: (sub: SubRow) => PushPayload | null): Promise<{ sent: number; gone: number; failed: number }> {
  const out = { sent: 0, gone: 0, failed: 0 };
  const db = await sql();
  const queue = subs.slice();
  const worker = async () => {
    for (;;) {
      const sub = queue.shift();
      if (!sub) return;
      const payload = pick(sub);
      if (!payload) continue;
      const r = await sendOne(sub, payload);
      out[r]++;
      try {
        if (r === "gone") await db`delete from desk_push_subs where id = ${sub.id}`;
        else if (r === "sent") await db`update desk_push_subs set last_sent = now(), fails = 0 where id = ${sub.id}`;
        else await db`update desk_push_subs set fails = fails + 1 where id = ${sub.id}`;
      } catch {
        /* bookkeeping only */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return out;
}

/** How many owner subscriptions the watchdog could actually reach right now.
 *  Zero means the internal alert has no recipient — surfaced separately on
 *  /status so a dead alert channel is visible without faking a data problem. */
export async function ownerSubCount(): Promise<number> {
  const db = await sql();
  const rows = await db<{ n: number }>`select count(*)::int as n from desk_push_subs where owner and fails < ${MAX_FAILS}`;
  return rows[0]?.n ?? 0;
}

async function subsFor(kind: "call" | "settle" | "owner"): Promise<SubRow[]> {
  const db = await sql();
  if (kind === "owner") return db<SubRow>`select id, endpoint, p256dh, auth, token from desk_push_subs where owner and fails < ${MAX_FAILS}`;
  return kind === "call"
    ? db<SubRow>`select id, endpoint, p256dh, auth, token from desk_push_subs where on_call and fails < ${MAX_FAILS}`
    : db<SubRow>`select id, endpoint, p256dh, auth, token from desk_push_subs where on_settle and fails < ${MAX_FAILS}`;
}

function fmtC(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}¢`;
}

function fmtLeft(mins: number): string {
  const s = Math.max(0, Math.round(mins * 60));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function callPayload(lean: "UP" | "DOWN", cents: number, minsLeft: number, ticker: string): PushPayload {
  return {
    title: `SATOSHI called ${lean}`,
    body: `${cents.toFixed(0)}¢ ask · ${fmtLeft(minsLeft)} left in the window`,
    tag: `call-${ticker}`,
    url: "/",
  };
}

export function settlePayload(
  winner: "UP" | "DOWN",
  chair: { entry: number; settle: number; ev: number } | null,
  mine: number | null | undefined,
  ticker: string,
): PushPayload {
  const chairBit = chair ? `chair ${fmtC(chair.ev)} (${chair.entry.toFixed(0)}¢ → ${chair.settle.toFixed(0)}¢)` : "chair sat out";
  const mineBit = mine == null ? "" : ` · you ${fmtC(mine)}`;
  return { title: `${winner} settled`, body: `${chairBit}${mineBit}`, tag: `settle-${ticker}`, url: "/" };
}

let lastLog = "";
export function pushLastLog(): string {
  return lastLog;
}

/** The chair just booked a call. Fire and forget. */
export function notifyCall(lean: "UP" | "DOWN", cents: number, minsLeft: number, ticker: string): void {
  void (async () => {
    try {
      const subs = await subsFor("call");
      if (!subs.length) return;
      const payload = callPayload(lean, cents, minsLeft, ticker);
      const r = await fanout(subs, () => payload);
      lastLog = `call ${ticker}: ${r.sent} sent, ${r.gone} gone, ${r.failed} failed`;
    } catch (err) {
      lastLog = `call push failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  })();
}

/** A window graded. humans maps Arena tokens to their cents on this window. */
export function notifySettle(
  ticker: string,
  winner: "UP" | "DOWN",
  chair: { entry: number; settle: number; ev: number } | null,
  humans: Map<string, number>,
): void {
  void (async () => {
    try {
      const subs = await subsFor("settle");
      if (!subs.length) return;
      // Only windows that mattered to this browser: its own lock, or a chair call. Quiet windows stay quiet.
      const r = await fanout(subs, (sub) => (settleWanted(sub, chair != null, humans) ? settlePayload(winner, chair, sub.token ? humans.get(sub.token) : null, ticker) : null));
      lastLog = `settle ${ticker}: ${r.sent} sent, ${r.gone} gone, ${r.failed} failed`;
    } catch (err) {
      lastLog = `settle push failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  })();
}

/** The desk stopped grading, or started again. Owner browsers only. Fire and forget. */
export function notifyWatchdog(payload: WatchdogPayload): void {
  void (async () => {
    try {
      const subs = await subsFor("owner");
      if (!subs.length) return;
      const r = await fanout(subs, () => payload);
      lastLog = `watchdog: ${r.sent} sent, ${r.gone} gone, ${r.failed} failed`;
    } catch (err) {
      lastLog = `watchdog push failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  })();
}

/** One test push to a single subscription, so a visitor can see it land. */
export async function testPush(endpointRaw: unknown): Promise<PushResult> {
  const endpoint = cleanEndpoint(endpointRaw);
  if (!endpoint) return { ok: false, error: "no endpoint", status: 400 };
  const db = await sql();
  const rows = await db<SubRow & PushPrefs>`
    select id, endpoint, p256dh, auth, token, on_call, on_settle, owner from desk_push_subs where endpoint = ${endpoint}
  `;
  const sub = rows[0];
  if (!sub) return { ok: false, error: "this browser is not subscribed", status: 404 };
  const r = await sendOne(sub, { title: "Satoshi's Council", body: "Alerts are on. This is what a call looks like.", tag: "test", url: "/" });
  if (r === "gone") {
    await db`delete from desk_push_subs where id = ${sub.id}`;
    return { ok: false, error: "the push service says this subscription is gone — turn alerts off and on again", status: 410 };
  }
  if (r === "failed") return { ok: false, error: "the push service refused the test", status: 502 };
  return { ok: true, prefs: { on_call: sub.on_call, on_settle: sub.on_settle, owner: sub.owner } };
}

export const __test = { fanout, cleanEndpoint, cleanKey };
