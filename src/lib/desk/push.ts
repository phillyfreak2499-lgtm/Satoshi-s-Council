/** Client side of push alerts: the service worker registration, the browser
 *  subscription, and the three calls the SETTINGS panel makes. */
import { arenaToken } from "./arena";

export type PushPrefs = { on_call: boolean; on_settle: boolean; owner: boolean };
/** What a visitor chooses; the owner flag is set separately, with the admin key. */
export type PushChoice = { on_call: boolean; on_settle: boolean };

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    (window.isSecureContext ?? true)
  );
}

/** iPhone and iPad only deliver web push to apps on the Home Screen. */
export function needsHomeScreen(): boolean {
  if (typeof navigator === "undefined") return false;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
  return !standalone;
}

export function pushPermission(): NotificationPermission | "unsupported" {
  return pushSupported() ? Notification.permission : "unsupported";
}

function b64ToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToB64(b: ArrayBuffer | null): string {
  if (!b) return "";
  let s = "";
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function serverKey(endpoint?: string): Promise<{ key: string; prefs: PushPrefs | null }> {
  const q = endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : "";
  const r = await fetch(`/push${q}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  const j = (await r.json()) as { key?: string; prefs?: PushPrefs | null; error?: string };
  if (!r.ok || !j.key) throw new Error(j.error || `push ${r.status}`);
  return { key: j.key, prefs: j.prefs ?? null };
}

async function post(body: Record<string, unknown>): Promise<PushPrefs> {
  const r = await fetch("/push", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json()) as { ok?: boolean; prefs?: PushPrefs; error?: string };
  if (!r.ok || !j.ok) throw new Error(j.error || `push ${r.status}`);
  return j.prefs ?? { on_call: false, on_settle: false, owner: false };
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

/** What this browser has asked for, from the server, or null when it is off. */
export async function currentPrefs(): Promise<PushPrefs | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  try {
    return (await serverKey(sub.endpoint)).prefs;
  } catch {
    return null;
  }
}

/** Turn alerts on (or change what to hear about). Asks for permission if needed. */
export async function enablePush(prefs: PushChoice): Promise<PushPrefs> {
  if (!pushSupported()) throw new Error("this browser cannot receive push alerts");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("notifications are blocked for this site — allow them in the browser's site settings");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const { key } = await serverKey();
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const have = bytesToB64(sub.options.applicationServerKey as ArrayBuffer | null);
    if (have && have !== key.replace(/=+$/, "")) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) as BufferSource });
  }
  return post({
    action: "subscribe",
    subscription: sub.toJSON(),
    token: arenaToken(),
    on_call: prefs.on_call,
    on_settle: prefs.on_settle,
    ua: navigator.userAgent.slice(0, 200),
  });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    /* the server row goes regardless */
  }
  await post({ action: "unsubscribe", endpoint });
}

/** Owner only: flag this browser for the desk watchdog. The server checks the admin key. */
export async function setOwnerAlerts(on: boolean, key: string): Promise<PushPrefs> {
  const sub = await currentSubscription();
  if (!sub) throw new Error("turn alerts on in this browser first");
  return post({ action: "owner", endpoint: sub.endpoint, key, on });
}

export async function testPush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) throw new Error("alerts are off in this browser");
  await post({ action: "test", endpoint: sub.endpoint });
}
