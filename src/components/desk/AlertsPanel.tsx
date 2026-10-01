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
      setMsg(
        on
          ? "owner alerts on — enable call alerts, then send a test to verify this browser's owner call channel"
          : "owner alerts off in this browser",
      );
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
        <div className="font-mono text-micro text-subtle">
          {needsHomeScreen()
            ? "On iPhone and iPad, add this site to your Home Screen (Share → Add to Home Screen), open it there, then turn on alerts."
            : "This browser cannot receive push alerts."}
        </div>
      ) : blocked ? (
        <div role="status" className="font-sans text-ui leading-relaxed text-muted">
          Notifications are blocked for this site. Open your browser’s site permissions, allow notifications, then reload this page to enable alerts.
          <button type="button" className="btn btn-secondary mt-3" disabled={busy || !ready}
            onClick={() => void apply({ on_call: false, on_settle: false })}>
            Turn off alerts in this browser
          </button>
          {msg ? <p className="mt-2">{msg}</p> : null}
        </div>
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
            <div className="mb-2">
              <label className="flex items-center justify-between gap-2 font-mono text-ui text-muted">
                <span>
                  Owner call channel + <Tip k="settings.watchdog">Desk watchdog</Tip>{" "}
                  <span className="text-subtle">· owner only</span>
                </span>
                <input
                  type="checkbox"
                  checked={owner}
                  disabled={busy || !ready || blocked || !prefs}
                  onChange={(e) => void applyOwner(e.target.checked)}
                />
              </label>
              <div className="mt-1 font-mono text-micro text-subtle">
                {owner
                  ? onCall
                    ? "Owner channel enabled. Send a test and confirm it arrives on this device. Provider acceptance alone does not confirm delivery or activate calls."
                    : "Enable ‘When the chair books a call’ before testing the owner call channel."
                  : "This browser is not registered as an owner channel. Enable the owner channel here before testing it for recovery readiness."}{" "}
                Desk watchdog also alerts you if no window grades for twenty minutes.
              </div>
            </div>
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
                  .then(() =>
                    setMsg(
                      ownerMode
                        ? owner && onCall
                          ? "owner-channel test accepted — confirm it arrives on this device; this does not activate calls"
                          : "test accepted — this browser is not an enabled owner call channel"
                        : "test accepted — it should land in a moment",
                    ),
                  )
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
