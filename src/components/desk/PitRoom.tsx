import { humanRanks } from "@/lib/desk/display-evidence";
import { useCallback, useEffect, useRef, useState } from "react";
import { arenaName, fetchArena, setArenaName, type Arena, type ArenaRow } from "@/lib/desk/arena";
import type { PublicArenaSnapshot } from "@/lib/desk/arena-public";
import { fetchRack, lockCall, type Rack } from "@/lib/desk/pit";
import { CALLSIGN_RE, CALLSIGN_REJECT, isBlocked } from "@/lib/desk/callsign-guard";
import { GlobalHeader } from "./GlobalHeader";
import { beacon } from "@/lib/desk/beacon";
import {
  currentPrefs,
  enablePush,
  needsHomeScreen,
  pushSupported,
  type PushPrefs,
} from "@/lib/desk/push";
import { cn } from "@/lib/utils";
import { PitTour } from "./PitTour";
import { pitTourSeen } from "./prefs";
import { ARENA_ACK, KALSHI_NONAFFILIATION } from "@/lib/desk/arena-gate";

const POLL_MS = 4_000;
const JITTER_MS = 300;
const BOARD_MS = 60_000;
const LAST_SECS = 30;

function fmtC(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}¢`;
}

function fmtClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function fmtPx(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAsk(v: number): string {
  return v > 0 ? `${v.toFixed(v % 1 ? 1 : 0)}¢` : "—";
}

type BoardRow = ArenaRow & { desk: boolean };

function fmtWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
      new Date(iso),
    );
  } catch {
    return iso.slice(11, 16);
  }
}

function fmtDayTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(5, 16);
  }
}

function fmtSince(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
  } catch {
    return iso.slice(5, 10);
  }
}

function centsStr(v: number): string {
  return `${v.toFixed(v % 1 ? 1 : 0)}¢`;
}

/** Hands a line to the phone's share sheet, or copies it. Plain text, no images. */
async function shareText(text: string): Promise<"shared" | "copied" | "failed"> {
  try {
    const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    if (typeof nav.share === "function") {
      await nav.share({ text });
      return "shared";
    }
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

/** THE PIT: one page, one lock per window, paper only. */
export function PitRoom({ initial }: { initial?: PublicArenaSnapshot | null }) {
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [rack, setRack] = useState<Rack | null>(initial?.rack ?? null);
  const [rackErr, setRackErr] = useState<string | null>(null);
  const [board, setBoard] = useState<Arena | null>(initial?.board ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(initial?.rack.at ?? 0);
  const [tick, setTick] = useState(0);
  const prevN = useRef<number | null>(initial?.rack.n_locked ?? null);
  const [alert, setAlert] = useState<"off" | "on" | "busy" | "none">("none");
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const prefsRef = useRef<PushPrefs | null>(null);
  const [shared, setShared] = useState<string | null>(null);
  const [tourOn, setTourOn] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [acked, setAcked] = useState(false);

  const startTour = () => {
    setTourStep(0);
    setTourOn(true);
    beacon("pit_tour_start");
  };

  useEffect(() => {
    if (pitTourSeen()) return;
    const t = window.setTimeout(startTour, 500);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    setName(arenaName());
    beacon("room_view", true);
    if (!pushSupported()) return;
    let alive = true;
    currentPrefs()
      .then((p) => {
        if (!alive) return;
        prefsRef.current = p;
        setAlert(p?.on_settle ? "on" : "off");
      })
      .catch(() => alive && setAlert("off"));
    return () => {
      alive = false;
    };
  }, []);

  const turnOnSettleAlert = async () => {
    setAlert("busy");
    setAlertMsg(null);
    try {
      const p = await enablePush({ on_call: prefsRef.current?.on_call ?? false, on_settle: true });
      prefsRef.current = p;
      setAlert("on");
      setAlertMsg(
        needsHomeScreen()
          ? "on for this browser — on iPhone, alerts only arrive once the site is on your Home Screen"
          : "on for this browser",
      );
      beacon("settle_alert");
    } catch (e) {
      setAlert("off");
      setAlertMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const share = async (text: string) => {
    const r = await shareText(text);
    setShared(
      r === "shared" ? "shared" : r === "copied" ? "copied to the clipboard" : "could not share",
    );
    if (r !== "failed") beacon("share");
    window.setTimeout(() => setShared(null), 3_000);
  };

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const applyRack = useCallback((r: Rack) => {
    setRack(r);
    setRackErr(null);
    if (prevN.current != null && r.n_locked > prevN.current) setTick((t) => t + 1);
    prevN.current = r.n_locked;
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const loop = async () => {
      if (!alive) return;
      if (!document.hidden) {
        try {
          applyRack(await fetchRack());
        } catch (e) {
          if (alive) setRackErr(e instanceof Error ? e.message : String(e));
        }
      }
      if (alive) timer = window.setTimeout(loop, POLL_MS + (Math.random() * 2 - 1) * JITTER_MS);
    };
    void loop();
    const onVis = () => {
      if (!document.hidden) {
        window.clearTimeout(timer);
        void loop();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [applyRack]);

  const settledKey = rack?.last?.winner ?? "";
  const [boardKey, setBoardKey] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchArena()
        .then((b) => {
          if (alive) setBoard(b);
        })
        .catch(() => {});
    void load();
    const id = window.setInterval(load, BOARD_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [settledKey, boardKey]);

  const w = rack?.window ?? null;
  const closeMs = w ? Date.parse(w.close_time) : 0;
  const secsLeft = w ? Math.max(0, (closeMs - now) / 1000) : 0;
  const tooLate = !w || secsLeft < LAST_SECS;
  const mine = rack?.mine ?? null;
  const last = rack?.last ?? null;
  const canLock = Boolean(name) && !!w && !mine && !tooLate && !busy && !w.stale;

  const lock = async (lean: "UP" | "DOWN") => {
    setBusy(true);
    setErr(null);
    try {
      const { rack: r } = await lockCall(lean);
      if (r) applyRack(r);
      else applyRack(await fetchRack());
      setBoardKey((k) => k + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const humans = board?.week ?? [];
  const ranks = humanRanks(humans);
  const rows: BoardRow[] = [
    ...humans.map((r) => ({ ...r, desk: false })),
    ...(board?.desk_week ?? []).map((r) => ({ ...r, desk: true })),
  ];
  const me = rack?.me ?? null;

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <GlobalHeader
        action={{ label: "Arena tour", hint: "60-second guide", onSelect: startTour }}
      />
      <div className="gutter mx-auto flex max-w-md flex-col gap-3 pb-10 pt-3 sm:max-w-lg lg:max-w-3xl">
        <p className="font-mono text-micro text-muted">
          Paper calls only. Not advice. Not Kalshi orders.
        </p>
        <section data-pit="window" className="rounded-md border border-border bg-surface px-3 py-2" aria-live="off">
          {w ? (
            <>
              <div className="flex items-baseline justify-between gap-2 font-mono">
                <span className="min-w-0">
                  <span className="truncate text-ui text-fg">{w.ticker}</span>
                  <span className="mt-0.5 block font-mono text-micro text-subtle">{KALSHI_NONAFFILIATION}</span>
                </span>
                <span className="text-ui tabular text-muted">
                  mid{" "}
                  <span className="text-fg">{w.mid == null ? "—" : `${w.mid.toFixed(1)}¢`}</span>
                </span>
                <span className={cn("text-title tabular", secsLeft < LAST_SECS ? "text-down" : "text-fg")} aria-label={`${fmtClock(secsLeft)} left in the window`}>
                  {fmtClock(secsLeft)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-micro tabular text-subtle">
                <span>strike {fmtPx(w.strike)}</span>
                <span>YES {fmtAsk(w.yes_bid)} / {fmtAsk(w.yes_ask)}</span>
                <span>NO {fmtAsk(w.no_bid)} / {fmtAsk(w.no_ask)}</span>
                {w.stale ? <span className="text-wait">quote stale</span> : null}
                {rack?.chair ? <span>{rack.chair}</span> : null}
              </div>
            </>
          ) : (
            <div className="font-mono text-micro text-muted">
              {rackErr ? `the rack is not answering: ${rackErr}` : rack ? "The desk has no live window right now. Kalshi's 15-minute Bitcoin market runs on a schedule." : "finding the window…"}
            </div>
          )}
        </section>
        <div data-pit="lock" className="grid gap-3">
          {!name ? (
            <form className="grid gap-2 rounded-md border border-border bg-surface p-3" onSubmit={(e) => {
              e.preventDefault();
              if (!acked) { setErr("acknowledge the paper rules before you enter"); return; }
              const v = draft.trim().replace(/\s+/g, " ");
              if (isBlocked(v)) setErr(CALLSIGN_REJECT);
              else if (CALLSIGN_RE.test(v)) { setArenaName(v); setName(v); }
              else setErr("a callsign is 2–16 letters, digits, spaces, dots, dashes or underscores");
            }}>
              <label className="font-mono text-micro uppercase tracking-widest text-subtle" htmlFor="pit-callsign">pick a callsign</label>
              <input id="pit-callsign" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={16} autoComplete="off" placeholder="2–16 letters or digits" className="min-h-12 rounded-sm border border-border bg-bg px-3 font-mono text-ui text-fg" />
              <label className="flex items-start gap-2 font-sans text-ui leading-snug text-fg">
                <input type="checkbox" className="mt-1 size-4 shrink-0" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
                <span>{ARENA_ACK}</span>
              </label>
              <button type="submit" disabled={!acked} className="min-h-12 rounded-sm bg-fg px-4 font-mono text-ui font-medium text-bg hover:bg-chip disabled:cursor-not-allowed disabled:opacity-50">Enter the Arena</button>
              <span className="font-mono text-micro text-subtle">no login — the callsign lives in this browser</span>
            </form>
          ) : null}
          {name && mine ? (
            <div className="rounded-md border-2 border-wait bg-wait/10 px-3 py-3 font-mono transition-colors duration-300" role="status">
              <div className="text-title font-medium tabular text-fg">YOU LOCKED <span className={mine.lean === "UP" ? "text-up" : "text-down"}>{mine.lean}</span> · {mine.entry_cents.toFixed(mine.entry_cents % 1 ? 1 : 0)}¢ · {fmtClock(secsLeft)}</div>
              <div className="mt-1 text-micro text-muted">paper · one lock per window · settles at the close on Kalshi's official value</div>
            </div>
          ) : name ? (
            <div className="grid gap-2">
              <button type="button" disabled={!canLock || !(w && w.yes_ask > 0)} onClick={() => void lock("UP")} className={cn("min-h-12 rounded-sm border px-4 font-mono text-ui font-medium tabular", canLock && w && w.yes_ask > 0 ? "border-up/50 bg-up/15 text-up hover:bg-up/25" : "border-border bg-surface-2 text-subtle")}>UP @ {w ? fmtAsk(w.yes_ask) : "—"}</button>
              <button type="button" disabled={!canLock || !(w && w.no_ask > 0)} onClick={() => void lock("DOWN")} className={cn("min-h-12 rounded-sm border px-4 font-mono text-ui font-medium tabular", canLock && w && w.no_ask > 0 ? "border-down/50 bg-down/15 text-down hover:bg-down/25" : "border-border bg-surface-2 text-subtle")}>DOWN @ {w ? fmtAsk(w.no_ask) : "—"}</button>
            </div>
          ) : null}
          {err ? <div className="font-mono text-micro text-down">{err}</div> : null}
        </div>
        <section data-pit="pit" className="rounded-md border border-border bg-surface px-3 py-2">
          <div className="flex items-baseline justify-between font-mono">
            <span className="text-micro uppercase tracking-widest text-subtle">arena</span>
            <span key={tick} className="pit-tick text-ui tabular text-fg">ARENA — {rack?.n_locked ?? 0} LOCKED</span>
          </div>
        </section>
        <div data-pit="record" className="grid gap-3">
          {name ? <div className="font-mono text-micro tabular text-muted"><span className="text-fg">{me?.name ?? name}</span></div> : null}
        </div>
        <footer className="font-mono text-micro text-subtle">Paper calls only · net ¢ after fees · not affiliated with Kalshi</footer>
      </div>
      <PitTour open={tourOn} step={tourStep} onStep={setTourStep} onClose={() => setTourOn(false)} onDone={() => beacon("pit_tour_done")} />
    </div>
  );
}
