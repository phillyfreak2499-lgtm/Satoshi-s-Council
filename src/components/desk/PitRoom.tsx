import { useCallback, useEffect, useRef, useState } from "react";
import { arenaName, fetchArena, setArenaName, type Arena, type ArenaRow } from "@/lib/desk/arena";
import { fetchRack, lockCall, type Rack } from "@/lib/desk/pit";
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
export function PitRoom() {
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [rack, setRack] = useState<Rack | null>(null);
  const [rackErr, setRackErr] = useState<string | null>(null);
  const [board, setBoard] = useState<Arena | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const prevN = useRef<number | null>(null);
  const [alert, setAlert] = useState<"off" | "on" | "busy" | "none">("none");
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const prefsRef = useRef<PushPrefs | null>(null);
  const [shared, setShared] = useState<string | null>(null);
  const [tourOn, setTourOn] = useState(false);
  const [tourStep, setTourStep] = useState(0);

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

  // The clock is client-side: one repaint a second from close_time, no network.
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

  // The rack: every ~4 s with jitter, paused while the tab is hidden.
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

  // The week board: once a minute, after our own lock, and again when a lock of ours settles.
  const settledKey = rack?.last?.winner ?? "";
  const [boardKey, setBoardKey] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchArena()
        .then((b) => {
          if (alive) setBoard(b);
        })
        .catch(() => {
          /* the rack still works; the board fills in later */
        });
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
  const rows: BoardRow[] = [
    ...humans.map((r) => ({ ...r, desk: false })),
    ...(board?.desk_week ?? []).map((r) => ({ ...r, desk: true })),
  ].sort((a, b) => Number(Boolean(a.warming)) - Number(Boolean(b.warming)) || b.net - a.net);
  const me = rack?.me ?? null;

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto flex max-w-md flex-col gap-3 px-3 pb-10 pt-3 sm:max-w-lg">
        <header className="flex items-center justify-between gap-2">
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">
            Satoshi&apos;s Council · <span className="text-fg">THE PIT</span>
          </div>
          <span className="flex items-center gap-3">
            <button
              type="button"
              onClick={startTour}
              className="flex min-h-11 items-center font-mono text-micro text-muted hover:text-fg"
            >
              how it works
            </button>
            <a
              href="/"
              className="flex min-h-11 items-center font-mono text-micro text-muted hover:text-fg"
            >
              open the desk →
            </a>
          </span>
        </header>
        <p className="font-mono text-micro text-muted">
          Paper calls only. Not advice. Not Kalshi orders.
        </p>

        {/* window strip */}
        <section
          data-pit="window"
          className="rounded-md border border-border bg-surface px-3 py-2"
          aria-live="off"
        >
          {w ? (
            <>
              <div className="flex items-baseline justify-between gap-2 font-mono">
                <span className="truncate text-ui text-fg">{w.ticker}</span>
                <span className="text-ui tabular text-muted">
                  mid{" "}
                  <span className="text-fg">{w.mid == null ? "—" : `${w.mid.toFixed(1)}¢`}</span>
                </span>
                <span
                  className={cn(
                    "text-title tabular",
                    secsLeft < LAST_SECS ? "text-down" : "text-fg",
                  )}
                  aria-label={`${fmtClock(secsLeft)} left in the window`}
                >
                  {fmtClock(secsLeft)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-micro tabular text-subtle">
                <span>strike {fmtPx(w.strike)}</span>
                <span>
                  YES {fmtAsk(w.yes_bid)} / {fmtAsk(w.yes_ask)}
                </span>
                <span>
                  NO {fmtAsk(w.no_bid)} / {fmtAsk(w.no_ask)}
                </span>
                {w.stale ? <span className="text-wait">quote stale</span> : null}
                {rack?.chair ? <span>{rack.chair}</span> : null}
              </div>
            </>
          ) : (
            <div className="font-mono text-micro text-muted">
              {rackErr
                ? `the rack is not answering: ${rackErr}`
                : rack
                  ? "The desk has no live window right now. Kalshi's 15-minute Bitcoin market runs on a schedule."
                  : "finding the window…"}
            </div>
          )}
        </section>

        <div data-pit="lock" className="grid gap-3">
          {/* callsign gate */}
          {!name ? (
            <form
              className="grid gap-2 rounded-md border border-border bg-surface p-3"
              onSubmit={(e) => {
                e.preventDefault();
                const v = draft.trim().replace(/\s+/g, " ");
                if (/^[A-Za-z0-9 _\-.]{2,16}$/.test(v)) {
                  setArenaName(v);
                  setName(v);
                } else
                  setErr("a callsign is 2–16 letters, digits, spaces, dots, dashes or underscores");
              }}
            >
              <label
                className="font-mono text-micro uppercase tracking-widest text-subtle"
                htmlFor="pit-callsign"
              >
                pick a callsign
              </label>
              <input
                id="pit-callsign"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={16}
                autoComplete="off"
                placeholder="2–16 letters or digits"
                className="min-h-12 rounded-sm border border-border bg-bg px-3 font-mono text-ui text-fg"
              />
              <button
                type="submit"
                className="min-h-12 rounded-sm bg-fg px-4 font-mono text-ui font-medium text-bg hover:bg-chip"
              >
                Take a stool
              </button>
              <span className="font-mono text-micro text-subtle">
                no login — the callsign lives in this browser
              </span>
            </form>
          ) : null}

          {/* ticket or buttons */}
          {name && mine ? (
            <div
              className="rounded-md border-2 border-wait bg-wait/10 px-3 py-3 font-mono transition-colors duration-300"
              role="status"
            >
              <div className="text-title font-medium tabular text-fg">
                YOU LOCKED{" "}
                <span className={mine.lean === "UP" ? "text-up" : "text-down"}>{mine.lean}</span> ·{" "}
                {mine.entry_cents.toFixed(mine.entry_cents % 1 ? 1 : 0)}¢ · {fmtClock(secsLeft)}
              </div>
              <div className="mt-1 text-micro text-muted">
                paper · one lock per window · settles at the close on Kalshi&apos;s official value
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {alert !== "none" ? (
                  alert === "on" ? (
                    <span className="min-h-11 inline-flex items-center rounded-sm border border-border px-3 text-micro text-muted">
                      ✓ you&apos;ll be told when it settles
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={alert === "busy"}
                      onClick={() => void turnOnSettleAlert()}
                      className="min-h-11 rounded-sm border border-border bg-surface px-3 text-micro text-fg hover:bg-surface-2 disabled:opacity-50"
                    >
                      {alert === "busy" ? "asking the browser…" : "Tell me when it settles"}
                    </button>
                  )
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    void share(
                      `I locked ${mine.lean} at ${centsStr(mine.entry_cents)} on the ${w ? fmtWhen(w.close_time) : ""} Bitcoin window (paper) · satoshiscouncil.com/arena`,
                    )
                  }
                  className="min-h-11 rounded-sm border border-border bg-surface px-3 text-micro text-fg hover:bg-surface-2"
                >
                  share
                </button>
                {shared ? <span className="text-micro text-subtle">{shared}</span> : null}
              </div>
              {alertMsg ? <div className="mt-1 text-micro text-subtle">{alertMsg}</div> : null}
            </div>
          ) : name ? (
            <div className="grid gap-2">
              <button
                type="button"
                disabled={!canLock || !(w && w.yes_ask > 0)}
                onClick={() => void lock("UP")}
                className={cn(
                  "min-h-12 rounded-sm border px-4 font-mono text-ui font-medium tabular",
                  canLock && w && w.yes_ask > 0
                    ? "border-up/50 bg-up/15 text-up hover:bg-up/25"
                    : "border-border bg-surface-2 text-subtle",
                )}
              >
                UP @ {w ? fmtAsk(w.yes_ask) : "—"}
              </button>
              <button
                type="button"
                disabled={!canLock || !(w && w.no_ask > 0)}
                onClick={() => void lock("DOWN")}
                className={cn(
                  "min-h-12 rounded-sm border px-4 font-mono text-ui font-medium tabular",
                  canLock && w && w.no_ask > 0
                    ? "border-down/50 bg-down/15 text-down hover:bg-down/25"
                    : "border-border bg-surface-2 text-subtle",
                )}
              >
                DOWN @ {w ? fmtAsk(w.no_ask) : "—"}
              </button>
              <div className="font-mono text-micro text-subtle">
                {!w
                  ? "no window to lock on"
                  : tooLate
                    ? "closed — inside the last 30 seconds"
                    : w.stale
                      ? "quote stale — hold on"
                      : "one paper lock per window · booked at the ask plus Kalshi's fee · paper"}
              </div>
            </div>
          ) : null}
          {err ? <div className="font-mono text-micro text-down">{err}</div> : null}
        </div>

        {/* last lock, once the window has rolled */}
        {name && !mine && last ? (
          <div
            className={cn(
              "rounded-md border px-3 py-2 font-mono transition-colors duration-300",
              last.winner == null
                ? "border-wait/70 bg-wait/5"
                : (last.cents ?? 0) > 0
                  ? "border-up/70 bg-up/10"
                  : "border-down/70 bg-down/10",
            )}
          >
            <div className="text-micro uppercase tracking-widest text-subtle">your last lock</div>
            <div className="text-ui tabular text-fg">
              <span className={last.lean === "UP" ? "text-up" : "text-down"}>{last.lean}</span> ·{" "}
              {last.entry_cents.toFixed(last.entry_cents % 1 ? 1 : 0)}¢ ·{" "}
              {last.winner == null ? (
                <span className="text-wait">settling…</span>
              ) : (
                <>
                  settled {last.winner} ·{" "}
                  <span className={(last.cents ?? 0) > 0 ? "text-up" : "text-down"}>
                    {fmtC(last.cents)}
                  </span>{" "}
                  paper
                </>
              )}
            </div>
            {last.winner != null && rack?.last_settle?.value != null ? (
              <div className="mt-0.5 text-micro tabular text-muted">
                {fmtPx(rack.last_settle.value)}
                {rack.last_settle.strike != null
                  ? ` vs strike ${fmtPx(rack.last_settle.strike)}`
                  : ""}{" "}
                · Kalshi&apos;s official value
              </div>
            ) : null}
            {last.winner != null ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void share(
                      `I called ${last.lean} at ${centsStr(last.entry_cents)} on the ${fmtWhen(last.close_time)} Bitcoin window · settled ${fmtC(last.cents)} (paper) · satoshiscouncil.com/arena`,
                    )
                  }
                  className="min-h-11 rounded-sm border border-border bg-surface px-3 text-micro text-fg hover:bg-surface-2"
                >
                  share
                </button>
                {shared ? <span className="text-micro text-subtle">{shared}</span> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* pit bar */}
        <section data-pit="pit" className="rounded-md border border-border bg-surface px-3 py-2">
          <div className="flex items-baseline justify-between font-mono">
            <span className="text-micro uppercase tracking-widest text-subtle">pit</span>
            <span key={tick} className="pit-tick text-ui tabular text-fg">
              PIT — {rack?.n_locked ?? 0} LOCKED
            </span>
          </div>
          {rack?.split ? (
            <>
              <div
                className="mt-2 flex h-3 overflow-hidden rounded-sm bg-surface-3"
                aria-hidden="true"
              >
                <div
                  className="bg-up transition-[width] duration-300"
                  style={{ width: `${rack.split.up_pct}%` }}
                />
                <div className="flex-1 bg-down" />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-micro tabular text-muted">
                <span className="text-up">UP {rack.split.up_pct}%</span>
                <span className="text-down">DOWN {rack.split.down_pct}%</span>
                <span>avg paper lock: {rack.split.avg_paper_cents.toFixed(1)}¢</span>
                <span className="text-subtle">{rack.n_locked} paper locks</span>
              </div>
            </>
          ) : (
            <>
              <div className="mt-2 h-3 rounded-sm border border-border" aria-hidden="true" />
              <div className="mt-1 font-mono text-micro text-subtle">
                Lock your call to reveal the room.
              </div>
            </>
          )}
        </section>

        {/* my line */}
        <div data-pit="record" className="grid gap-3">
          {name ? (
            <div className="font-mono text-micro tabular text-muted">
              <span className="text-fg">{me?.name ?? name}</span>
              {me && me.n > 0 ? (
                <>
                  {" "}
                  · {me.wins}–{me.losses} ·{" "}
                  <span className={me.net >= 0 ? "text-up" : "text-down"}>{fmtC(me.net)}</span> net
                  after fees
                  {me.rank_week ? ` · #${me.rank_week} of ${me.players_week} this week` : ""}
                </>
              ) : (
                " · no settled locks yet"
              )}
            </div>
          ) : null}
          {name && board?.me?.calls?.length ? (
            <section className="rounded-md border border-border bg-surface px-3 py-2">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">
                your last {Math.min(10, board.me.calls.length)} locks
              </div>
              <ul className="mt-1 grid gap-1 font-mono text-micro tabular">
                {board.me.calls.slice(0, 10).map((c) => (
                  <li key={c.ticker} className="flex items-center justify-between gap-2">
                    <span className="text-subtle">{fmtDayTime(c.close_time)}</span>
                    <span className={c.lean === "UP" ? "text-up" : "text-down"}>{c.lean}</span>
                    <span className="text-muted">{centsStr(c.entry_cents)}</span>
                    <span
                      className={
                        c.winner == null
                          ? "text-wait"
                          : (c.cents ?? 0) > 0
                            ? "text-up"
                            : "text-down"
                      }
                    >
                      {c.winner == null ? "open" : fmtC(c.cents)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* week board */}
          <section className="rounded-md border border-border bg-surface px-3 py-2">
            <div className="flex items-baseline justify-between font-mono">
              <span className="text-micro uppercase tracking-widest text-subtle">this week</span>
              <span className="text-micro text-subtle">
                net ¢ after fees · paper · ranked after 3 settled
              </span>
            </div>
            {!humans.length ? (
              <div className="mt-2 font-mono text-micro text-muted">Take the first stool.</div>
            ) : null}
            <table className="mt-2 w-full font-mono text-micro">
              <thead className="text-subtle">
                <tr className="text-left">
                  <th className="py-1 pr-2 font-medium">#</th>
                  <th className="py-1 pr-2 font-medium">callsign</th>
                  <th className="py-1 pr-2 text-right font-medium">n</th>
                  <th className="py-1 pr-2 text-right font-medium">W–L</th>
                  <th className="py-1 text-right font-medium">net ¢</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((r, i) => (
                    <tr
                      key={`${r.desk ? "d" : "h"}:${r.name}`}
                      className={cn(
                        "border-t border-border/60",
                        r.me && "bg-surface-2",
                        r.desk && "text-muted",
                      )}
                    >
                      <td className="py-1.5 pr-2 tabular">{r.warming ? "—" : i + 1}</td>
                      <td className="py-1.5 pr-2">
                        {r.name}
                        {r.me ? <span className="text-subtle"> (you)</span> : null}
                        {r.warming ? <span className="text-subtle"> warming up</span> : null}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular">{r.n}</td>
                      <td className="py-1.5 pr-2 text-right tabular">
                        {r.wins}–{r.n - r.wins}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 text-right tabular",
                          r.desk
                            ? "text-muted"
                            : r.net > 0
                              ? "text-up"
                              : r.net < 0
                                ? "text-down"
                                : "text-muted",
                        )}
                      >
                        {fmtC(r.net)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-2 text-subtle">
                      {board ? "no graded windows this week yet" : "loading the board…"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
        <footer className="font-mono text-micro text-subtle">
          Paper calls only · net ¢ after fees · not affiliated with Kalshi ·{" "}
          <a href="/legal" className="hover:text-fg">
            paper only, in plain words
          </a>
        </footer>
      </div>
      <PitTour
        open={tourOn}
        step={tourStep}
        onStep={setTourStep}
        onClose={() => setTourOn(false)}
        onDone={() => beacon("pit_tour_done")}
      />
    </div>
  );
}
