import { useEffect, useState } from "react";
import {
  currentPrefs,
  disablePush,
  enablePush,
  needsHomeScreen,
  pushPermission,
  pushSupported,
  setOwnerAlerts,
  testPush,
  type PushChoice,
  type PushPrefs,
} from "@/lib/desk/push";
import { getAdminKey } from "@/lib/desk/engine";
import { Tip } from "./Tip";

/** SETTINGS → Alerts: opt in to a push when the chair books a call and,
 *  if wanted, when a window settles. Per browser; nothing is sent until a
 *  visitor turns it on here. */
export function AlertsPanel({ ownerMode = false }: { ownerMode?: boolean }) {
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const supported = pushSupported();

  useEffect(() => {
    let alive = true;
    currentPrefs()
      .then((p) => {
        if (alive) setPrefs(p);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const apply = async (next: PushChoice) => {
    setBusy(true);
    setMsg(null);
    try {
      if (!next.on_call && !next.on_settle) {
        await disablePush();
        setPrefs(null);
        setMsg("alerts are off in this browser");
      } else {
        const p = await enablePush(next);
        setPrefs(p);
        setMsg("alerts are on — send a test to see one land");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const applyOwner = async (on: boolean) => {
    const key = getAdminKey();
    if (!key) {
      setMsg("unlock owner controls first");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const p = await setOwnerAlerts(on, key);
      setPrefs(p);
      setMsg(on ? "watchdog on — a push here if no window grades for twenty minutes" : "watchdog off in this browser");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCall = prefs?.on_call ?? false;
  const onSettle = prefs?.on_settle ?? false;
  const owner = prefs?.owner ?? false;
  const blocked = pushPermission() === "denied";

  return (
    <section className="rounded-md border border-border bg-surface p-3">
      <h3 className="mb-3 font-mono text-micro uppercase tracking-widest text-subtle">
        <Tip k="settings.alerts">Alerts</Tip>
      </h3>
      {!supported ? (
        <div className="font-mono text-micro text-subtle">This browser cannot receive push alerts.</div>
      ) : (
        <>
          <label className="mb-2 flex items-center justify-between gap-2 font-mono text-ui text-muted">
            When the chair books a call
            <input
              type="checkbox"
              checked={onCall}
              disabled={busy || !ready || blocked}
              onChange={(e) => void apply({ on_call: e.target.checked, on_settle: onSettle })}
            />
          </label>
          <label className="mb-2 flex items-center justify-between gap-2 font-mono text-ui text-muted">
            When a window you locked, or the chair called, settles
            <input
              type="checkbox"
              checked={onSettle}
              disabled={busy || !ready || blocked}
              onChange={(e) => void apply({ on_call: onCall, on_settle: e.target.checked })}
            />
          </label>
          {ownerMode ? (
            <label className="mb-2 flex items-center justify-between gap-2 font-mono text-ui text-muted">
              <span>
                <Tip k="settings.watchdog">Desk watchdog</Tip>{" "}
                <span className="text-subtle">· owner only</span>
              </span>
              <input
                type="checkbox"
                checked={owner}
                disabled={busy || !ready || blocked || !prefs}
                onChange={(e) => void applyOwner(e.target.checked)}
              />
            </label>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !prefs}
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setBusy(true);
                setMsg(null);
                testPush()
                  .then(() => setMsg("test sent — it should land in a moment"))
                  .catch((e) => setMsg(e instanceof Error ? e.message : String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              send a test
            </button>
            <span className="font-mono text-micro text-subtle">
              {blocked ? "notifications are blocked for this site in the browser" : !ready ? "checking…" : prefs ? "on in this browser" : "off"}
            </span>
          </div>
          {needsHomeScreen() ? (
            <div className="mt-2 font-mono text-micro text-wait">
              On iPhone and iPad, alerts only work once the site is on your Home Screen (Share → Add to Home Screen). Open it from there, then turn them on.
            </div>
          ) : null}
          {msg ? <div className="mt-2 font-mono text-micro text-muted">{msg}</div> : null}
          <div className="mt-2 font-mono text-micro text-subtle">
            One alert when the chair books, one when a window that mattered settles, nothing for quiet windows. Alerts are per browser — turn them on wherever you want them.
          </div>
        </>
      )}
    </section>
  );
}
