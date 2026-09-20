import { SEATS } from "@/lib/desk/seats";
import { formatRule } from "@/lib/desk/dsl";
import { recencyRate, skillCounts } from "@/lib/desk/skills";
import { ledgerRows } from "@/lib/desk/ledger";
import { FULL_N, WARM_N, calibNOf, seatCalib, wilsonLower } from "@/lib/desk/math";
import { THRESH_SPECS } from "@/lib/desk/thresholds";
import { useEffect, useState } from "react";
import {
  acceptCandidateNow,
  dismissCandidate,
  forceBench,
  getAdminKey,
  huddleNow,
  patchSettings,
  resetDemoWindow,
  setAdminKey,
  setMuted,
} from "@/lib/desk/engine";
import type { Learner, Settings as SettingsT } from "@/lib/desk/types";
import { cn } from "@/lib/utils";
import { Tip } from "./Tip";
import { AlertsPanel } from "./AlertsPanel";
import { DisplayPanel } from "./DisplayPanel";
import { ArenaAdminPanel } from "./ArenaAdminPanel";
import { ReadinessPanel } from "./ReadinessPanel";
import { AiCostPanel } from "./AiCostPanel";

async function ownerKeyIsValid(key: string): Promise<boolean> {
  if (!key) return false;
  const r = await fetch(`/readiness?key=${encodeURIComponent(key)}`, {
    headers: { accept: "application/json" },
  });
  return r.ok;
}

function OwnerAccess({
  unlocked,
  onUnlocked,
}: {
  unlocked: boolean;
  onUnlocked: (unlocked: boolean) => void;
}) {
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const saved = getAdminKey();
    if (!saved) return;
    let alive = true;
    setKey(saved);
    setChecking(true);
    ownerKeyIsValid(saved)
      .then((valid) => {
        if (!alive) return;
        if (valid) {
          onUnlocked(true);
          setMsg("owner key verified");
        } else {
          setAdminKey("");
          onUnlocked(false);
          setMsg("saved owner key is no longer valid");
        }
      })
      .catch(() => {
        if (alive) setMsg("could not verify owner access");
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [onUnlocked]);

  const unlock = async () => {
    const candidate = key.trim();
    setChecking(true);
    setMsg(null);
    try {
      if (!(await ownerKeyIsValid(candidate))) throw new Error("owner key not recognized");
      setAdminKey(candidate);
      onUnlocked(true);
      setMsg("owner key verified");
    } catch (e) {
      setAdminKey("");
      onUnlocked(false);
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  const lock = () => {
    setAdminKey("");
    setKey("");
    setMsg(null);
    onUnlocked(false);
  };

  return (
    <section className="rounded-md border border-border bg-surface p-3 lg:col-span-2">
      <details open={unlocked}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-mono text-ui text-muted">
          <span>Owner controls</span>
          <span className={unlocked ? "text-up" : "text-subtle"}>
            {unlocked ? "verified" : "locked"}
          </span>
        </summary>
        {unlocked ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="font-mono text-micro text-subtle">
              Shared-desk controls are visible in this browser only while the owner key is verified.
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={lock}>
              lock owner controls
            </button>
          </div>
        ) : (
          <form
            className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void unlock();
            }}
          >
            <label className="font-mono text-ui text-muted">
              Owner key
              <input
                type="password"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="required for shared-desk controls"
                autoComplete="off"
                className="mt-1 w-full rounded-sm border border-border bg-bg px-2 py-1.5 font-mono text-data text-fg"
              />
            </label>
            <button
              type="submit"
              disabled={checking || !key.trim()}
              className="btn btn-secondary self-end"
            >
              {checking ? "checking…" : "unlock"}
            </button>
            {msg ? (
              <div className="font-mono text-micro text-muted sm:col-span-2">{msg}</div>
            ) : null}
          </form>
        )}
      </details>
    </section>
  );
}

export function SettingsTab({ settings, learner }: { settings: SettingsT; learner: Learner }) {
  const [ownerMode, setOwnerMode] = useState(false);

  return (
    <div data-tour="tour-settings" className="grid gap-3 p-3 lg:grid-cols-2">
      <AlertsPanel ownerMode={ownerMode} />
      <DisplayPanel />
      <OwnerAccess unlocked={ownerMode} onUnlocked={setOwnerMode} />
      {ownerMode ? (
        <>
          <AiCostPanel />
          <ReadinessPanel />
          <ArenaAdminPanel />
          <section className="rounded-md border border-border bg-surface p-3">
        <h3 className="mb-3 font-mono text-micro uppercase tracking-widest text-subtle">Council</h3>
        <label className="mb-2 block font-mono text-ui text-muted">
          Poll interval
          <select
            className="mt-1 w-full rounded-sm border border-border bg-bg px-2 py-1.5 font-mono text-data text-fg"
            value={settings.beast ? 1500 : settings.poll_ms}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v === 1500) patchSettings({ beast: true, poll_ms: 1500 });
              else patchSettings({ beast: false, poll_ms: v });
            }}
          >
            <option value={1000}>1000 ms</option>
            <option value={2000}>2000 ms</option>
            <option value={3500}>3500 ms</option>
            <option value={1500}>Beast 1500 ms</option>
          </select>
        </label>
        <label className="mb-2 block font-mono text-ui text-muted">
          Data source
          <select
            className="mt-1 w-full rounded-sm border border-border bg-bg px-2 py-1.5 font-mono text-data text-fg"
            value={settings.source}
            onChange={(e) => patchSettings({ source: e.target.value as "demo" | "live" })}
          >
            <option value="demo">Demo</option>
            <option value="live">Live</option>
          </select>
          <div className="mt-1 font-mono text-micro text-subtle">
            Live is the shared brain — it runs on the server around the clock and every visitor
            sees the same desk. Demo is your own private sandbox in this browser.
          </div>
        </label>
        <label className="mb-2 flex items-center justify-between gap-2 font-mono text-ui text-muted">
          Adaptive confluence bar
          <input
            type="checkbox"
            checked={settings.adaptive_bar}
            onChange={(e) => patchSettings({ adaptive_bar: e.target.checked })}
          />
        </label>
        <label className="mb-2 block font-mono text-ui text-muted">
          Bar override {settings.bar_override ?? 0.3}
          <input
            type="range"
            min={0.24}
            max={0.72}
            step={0.01}
            value={settings.bar_override ?? 0.3}
            onChange={(e) =>
              patchSettings({ bar_override: Number(e.target.value), adaptive_bar: false })
            }
            className="mt-1 w-full"
          />
        </label>
        <label className="mb-2 flex items-center justify-between gap-2 font-mono text-ui text-muted">
          Show faded math
          <input
            type="checkbox"
            checked={settings.show_faded}
            onChange={(e) => patchSettings({ show_faded: e.target.checked })}
          />
        </label>
        <label className="mb-2 flex items-center justify-between gap-2 font-mono text-ui text-muted">
          Show shadow column
          <input
            type="checkbox"
            checked={settings.show_shadow}
            onChange={(e) => patchSettings({ show_shadow: e.target.checked })}
          />
        </label>
        <div className="mb-2 font-mono text-ui text-muted">Timezone {settings.tz}</div>
        <div className="flex flex-wrap gap-2">
          {settings.source === "demo" ? (
            <button
              type="button"
              className="rounded-sm border border-border bg-surface-2 px-3 py-1.5 font-mono text-ui text-fg"
              onClick={() => resetDemoWindow()}
            >
              Reset demo window
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-sm border border-border bg-surface-2 px-3 py-1.5 font-mono text-ui text-fg"
            onClick={() => huddleNow()}
          >
            Run huddle now
          </button>
          <button
            type="button"
            className="rounded-sm border border-border bg-surface-2 px-3 py-1.5 font-mono text-ui text-fg"
            onClick={() => window.dispatchEvent(new Event("satoshi-tour"))}
          >
            Replay 60s tour
          </button>
        </div>
      </section>

      <section className="rounded-md border border-border bg-surface p-3">
        <h3 className="mb-3 font-mono text-micro uppercase tracking-widest text-subtle">Mute seats</h3>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {SEATS.map((s) => {
            const on = settings.mutes.includes(s.id);
            return (
              <label key={s.id} className="flex items-center gap-2 font-mono text-ui">
                <input type="checkbox" checked={on} onChange={() => setMuted(s.id, !on)} />
                <span className={on ? "text-muted line-through" : "text-fg"}>
                  <Tip k={`seat.${s.id}`} mark={false}>
                    {s.id}
                  </Tip>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="rounded-md border border-border bg-surface p-3 lg:col-span-2">
        <h3 className="mb-3 font-mono text-micro uppercase tracking-widest text-subtle">
          Seat weights
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left">
            <thead className="font-mono text-micro uppercase text-subtle">
              <tr>
                {["seat", "prior", "live w", "n", "wilson", "rec"].map((h) => (
                  <th key={h} className="px-2 py-1 font-medium">
                    {h === "wilson" ? <Tip k="set.wilson">wilson</Tip> : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SEATS.filter((s) => s.id !== "WARDEN").map((s) => {
                const n = learner.seat_n[s.id] ?? 0;
                const calN = calibNOf(n, learner.seat_calib_debt?.[s.id] ?? 0);
                const hits = learner.seat_hits[s.id] ?? 0;
                const w = learner.seat_w?.[s.id] ?? s.base;
                const rec = learner.seat_recent[s.id] ?? [];
                const recRate = rec.length ? rec.reduce((a, b) => a + b, 0) / rec.length : 0;
                const moved = Math.abs(w - s.base) >= 0.01;
                return (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-2 py-1 font-mono text-micro text-fg">{s.id}</td>
                    <td className="px-2 py-1 font-mono text-micro tabular text-subtle">
                      {s.base.toFixed(2)}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1 font-mono text-micro tabular",
                        moved ? "text-wait" : "text-fg",
                      )}
                    >
                      {w.toFixed(2)}
                    </td>
                    <td className="px-2 py-1 font-mono text-micro tabular text-muted">
                      {n}
                      {calN < WARM_N
                        ? " · frozen"
                        : calN < FULL_N
                          ? ` · ${Math.round(seatCalib(calN) * 100)}%`
                          : " · full"}
                    </td>
                    <td className="px-2 py-1 font-mono text-micro tabular text-muted">
                      {n ? `${(wilsonLower(hits, n) * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-2 py-1 font-mono text-micro tabular text-muted">
                      {rec.length ? `${(recRate * 100).toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 font-mono text-micro text-subtle">
          Priors stay until n ≥ 8. Huddle rebuilds live w from Wilson × recency, clamped 0.4–2.2×
          prior, then renormalizes.
        </p>
      </section>

      <section className="rounded-md border border-border bg-surface p-3 lg:col-span-2">
        <h3 className="mb-3 font-mono text-micro uppercase tracking-widest text-subtle">
          Adaptive thresholds
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left">
            <thead className="font-mono text-micro uppercase text-subtle">
              <tr>
                {["id", "label", "base", "live", "regime n", "dir"].map((h) => (
                  <th key={h} className="px-2 py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(THRESH_SPECS).map(([id, spec]) => {
                const st = learner.thresholds?.[id];
                const n = Object.values(st?.by_regime ?? {}).reduce(
                  (s, p) => s + (p.samples?.length ?? 0),
                  0,
                );
                const regime = learner.last_regime
                  ? st?.by_regime[learner.last_regime]?.value
                  : undefined;
                return (
                  <tr key={id} className="border-t border-border">
                    <td className="px-2 py-1 font-mono text-micro text-fg">{id}</td>
                    <td className="px-2 py-1 font-mono text-micro text-muted">{spec.label}</td>
                    <td className="px-2 py-1 font-mono text-micro tabular text-subtle">
                      {spec.base}
                    </td>
                    <td className="px-2 py-1 font-mono text-micro tabular text-fg">
                      {(regime ?? st?.value ?? spec.base).toFixed(3)}
                    </td>
                    <td className="px-2 py-1 font-mono text-micro tabular text-muted">{n}</td>
                    <td className="px-2 py-1 font-mono text-micro text-subtle">{spec.dir}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 font-mono text-micro text-subtle">
          Each pocket retunes on settle. Misses tighten. Barely-made hits relax. Huddle searches the sample buffer.
        </p>
      </section>

      <section className="rounded-md border border-border bg-surface p-3 lg:col-span-2">
        <h3 className="mb-3 font-mono text-micro uppercase tracking-widest text-subtle">
          Skill library
        </h3>
        {learner.candidate && !learner.candidate.dismissed && (
          <div className="mb-3 rounded-sm border border-wait/40 bg-wait/10 p-2 font-mono text-ui">
            CANDIDATE {learner.candidate.id} · {learner.candidate.question}
            <div className="mt-1 text-micro text-muted">{learner.candidate.fire_when}</div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="rounded-sm border border-wait/50 px-2 py-1 text-wait"
                onClick={() => acceptCandidateNow()}
              >
                Accept → SHADOW
              </button>
              <button
                type="button"
                className="rounded-sm border border-border px-2 py-1 text-muted"
                onClick={() => dismissCandidate()}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[68rem] text-left">
            <thead className="font-mono text-micro uppercase text-subtle">
              <tr>
                {["id", "owner", "status", "dsl", "n", "hits", "L20", "Wilson", "EV¢", "Brier", "wait", "fade", "caps", "action"].map((h) => (
                  <th key={h} className="px-2 py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(learner.skills).map((c) => {
                const caps = skillCounts(learner, c.owner);
                const dsl = formatRule(c.rule);
                return (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-2 py-1 font-mono text-micro text-fg">{c.id}</td>
                    <td className="px-2 py-1 font-mono text-micro text-muted">{c.owner}</td>
                    <td
                      className={cn(
                        "px-2 py-1 font-mono text-micro",
                        c.status === "LIVE"
                          ? "text-up"
                          : c.status === "SHADOW"
                            ? "text-wait"
                            : "text-muted",
                      )}
                    >
                      {c.status}
                    </td>
                    <td className="max-w-[14rem] truncate px-2 py-1 font-mono text-micro text-subtle" title={dsl}>
                      {c.rule ? dsl : "—"}
                    </td>
                    <td className="px-2 py-1 font-mono text-micro tabular">{c.n}</td>
                    <td className="px-2 py-1 font-mono text-micro tabular">{c.hits}</td>
                    <td className="px-2 py-1 font-mono text-micro tabular">
                      {(recencyRate(c) * 100).toFixed(0)}%
                    </td>
                    <td className="px-2 py-1 font-mono text-micro tabular">
                      {(c.wilson * 100).toFixed(0)}%
                    </td>
                    <td
                      className={`px-2 py-1 font-mono text-micro tabular ${
                        (c.ev ?? 0) > 0 ? "text-up" : (c.ev ?? 0) < 0 ? "text-down" : "text-muted"
                      }`}
                    >
                      {c.ev_n ? `${c.ev >= 0 ? "+" : ""}${c.ev.toFixed(1)}` : "—"}
                    </td>
                    <td className="px-2 py-1 font-mono text-micro tabular">{c.brier.toFixed(3)}</td>
                    <td className="px-2 py-1 font-mono text-micro tabular text-muted">
                      {c.wait_good}/{c.wait_miss}
                    </td>
                    <td className="px-2 py-1 font-mono text-micro tabular text-muted">
                      {(learner.fade_strength[c.owner] ?? 0).toFixed(2)}
                    </td>
                    <td className="px-2 py-1 font-mono text-micro text-muted">
                      LIVE {caps.live}/3 · SHADOW {caps.shadow}/2
                    </td>
                    <td className="px-2 py-1">
                      {c.status !== "BENCH" && (
                        <button
                          type="button"
                          className="font-mono text-micro text-muted underline"
                          onClick={() => forceBench(c.id)}
                        >
                          Force-BENCH
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-border bg-surface p-3 lg:col-span-2">
        <h3 className="mb-3 font-mono text-micro uppercase tracking-widest text-subtle">
          Pattern ledger
        </h3>
        <p className="mb-2 font-mono text-micro text-subtle">
          WICK grades each named print on settle. n{"<"}8 stays uncalibrated (cap 40). n≥12 and Wilson
          {"<"}40% or EV{"<"}−1.8¢ folds the name until it earns its way back.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left">
            <thead className="font-mono text-micro uppercase text-subtle">
              <tr>
                {["kind", "n", "hits", "L20", "Wilson", "EV¢", "trust"].map((h) => (
                  <th key={h} className="px-2 py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ledgerRows(learner.pattern_book ?? {}, []).filter((r) => r.n > 0).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-2 font-mono text-micro text-muted">
                    No graded prints yet — WICK will fill this as windows settle.
                  </td>
                </tr>
              )}
              {ledgerRows(learner.pattern_book ?? {}, [])
                .filter((r) => r.n > 0)
                .map((r) => {
                  const l20 = r.last20.length
                    ? r.last20.reduce((a, b) => a + b, 0) / r.last20.length
                    : 0;
                  return (
                    <tr key={r.kind} className="border-t border-border">
                      <td className="px-2 py-1 font-mono text-micro text-fg">{r.kind}</td>
                      <td className="px-2 py-1 font-mono text-micro tabular text-muted">{r.n}</td>
                      <td className="px-2 py-1 font-mono text-micro tabular text-muted">{r.hits}</td>
                      <td className="px-2 py-1 font-mono text-micro tabular text-fg">
                        {r.last20.length ? `${Math.round(l20 * 100)}%` : "—"}
                      </td>
                      <td className="px-2 py-1 font-mono text-micro tabular text-fg">
                        {Math.round(r.wilson * 100)}%
                      </td>
                      <td
                        className={`px-2 py-1 font-mono text-micro tabular ${
                          r.ev > 0 ? "text-up" : r.ev < 0 ? "text-down" : "text-muted"
                        }`}
                      >
                        {r.ev_n ? `${r.ev >= 0 ? "+" : ""}${r.ev.toFixed(1)}` : "—"}
                      </td>
                      <td
                        className={`px-2 py-1 font-mono text-micro ${
                          r.trust.fold ? "text-down" : r.trust.uncalibrated ? "text-wait" : "text-up"
                        }`}
                      >
                        {r.trust.label}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
        </>
      ) : null}
    </div>
  );
}
