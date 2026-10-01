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
  verifyOwnerAlerts,
  type OwnerAlertVerification,
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
  const [verification, setVerification] = useState<OwnerAlertVerification | null>(null);
  const [fixturesAcknowledged, setFixturesAcknowledged] = useState(false);
  const [displayConfirmed, setDisplayConfirmed] = useState(false);
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
      if (!next.on_call && !next.on_settle && !next.on_read) {
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

  const verifyTiers = async (action: "status" | "verify" | "release" | "hold") => {
    const key = getAdminKey();
    if (!key) {
      setMsg("unlock owner controls first");
      return;
    }
    setBusy(true);
    setMsg(null);
    if (action === "verify" || action === "hold") {
      setDisplayConfirmed(false);
      setVerification(null);
    }
    try {
      const result = await verifyOwnerAlerts(key, action, verification?.verification_id);
      setVerification(result);
      setMsg(
        result.held
          ? "Subscriber paper/read alerts are held. Provider acceptance alone cannot release them."
          : "Subscriber paper/read alerts released for this deployed build after owner confirmation.",
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCall = prefs?.on_call ?? false;
  const onRead = prefs?.on_read ?? false;
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
      ) : (
        <>
          <label className="mb-2 flex items-center justify-between gap-2 font-mono text-ui text-muted">
            <span>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" className="inline">
                <rect x="2" y="2" width="12" height="12" fill="currentColor" />
              </svg>{" "}
              BOOKED · When the chair books a call
            </span>
            <input
              type="checkbox"
              checked={onCall}
              disabled={busy || !ready || blocked}
              onChange={(e) =>
                void apply({ on_call: e.target.checked, on_settle: onSettle, on_read: onRead })
              }
            />
          </label>
          <label className="mb-2 flex items-center justify-between gap-2 font-mono text-ui text-muted">
            When a window you locked, or the chair called, settles
            <input
              type="checkbox"
              checked={onSettle}
              disabled={busy || !ready || blocked}
              onChange={(e) =>
                void apply({ on_call: onCall, on_settle: e.target.checked, on_read: onRead })
              }
            />
          </label>
          <label className="mb-2 flex items-center justify-between gap-2 font-mono text-ui text-muted">
            <span>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" className="inline">
                <path d="M8 1 L15 8 L8 15 L1 8 Z" fill="none" stroke="currentColor" />
              </svg>{" "}
              READ ONLY · Unbooked Chair directional reads
            </span>
            <input
              type="checkbox"
              checked={onRead}
              disabled={busy || !ready || blocked}
              onChange={(e) =>
                void apply({ on_call: onCall, on_settle: onSettle, on_read: e.target.checked })
              }
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
          {ownerMode ? (
            <div className="my-3 rounded border border-border p-2 font-mono text-micro">
              <div>Two-tier rollout · owner only</div>
              <div className="my-1 text-subtle">
                Both subscriber tiers start held on each new deployed commit. The test sends fixture
                notifications only to this registered owner browser; it creates no paper position,
                research call or follower signal. Watchdog alerts are unaffected.
              </div>
              <label className="flex gap-2 my-2">
                <input
                  type="checkbox"
                  checked={fixturesAcknowledged}
                  disabled={busy}
                  onChange={(e) => setFixturesAcknowledged(e.target.checked)}
                />
                I understand both notifications use test fixtures and the exact approved alert copy.
              </label>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || !owner || !fixturesAcknowledged}
                onClick={() => void verifyTiers("verify")}
              >
                Test both tiers on this owner device
              </button>
              <label className="flex gap-2 my-2">
                <input
                  type="checkbox"
                  checked={displayConfirmed}
                  disabled={
                    busy ||
                    !verification?.verification_id ||
                    !verification.tiers?.every((t) => t.outcome === "accepted")
                  }
                  onChange={(e) => setDisplayConfirmed(e.target.checked)}
                />
                I saw both exact titles/messages and the filled BOOKED square versus hollow READ
                ONLY diamond.
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy || !owner || !displayConfirmed || !verification?.verification_id}
                  onClick={() => void verifyTiers("release")}
                >
                  Confirm display and release subscriber tiers
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy || !owner}
                  onClick={() => void verifyTiers("hold")}
                >
                  Hold subscriber tiers
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy || !owner}
                  onClick={() => void verifyTiers("status")}
                >
                  Check rollout status
                </button>
              </div>
              {verification ? (
                <div className="mt-2">
                  {verification.held ? "HELD" : "RELEASED"} · build{" "}
                  {verification.build_sha.slice(0, 10)}
                  {verification.tiers?.map((t) => (
                    <div key={t.tier}>
                      {t.tier}: {t.outcome} at push provider
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-subtle">Rollout status not yet checked.</div>
              )}
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
              {blocked
                ? "notifications are blocked for this site in the browser"
                : !ready
                  ? "checking…"
                  : prefs
                    ? "on in this browser"
                    : "off"}
            </span>
          </div>
          {needsHomeScreen() ? (
            <div className="mt-2 font-mono text-micro text-wait">
              On iPhone and iPad, alerts only work once the site is on your Home Screen (Share → Add
              to Home Screen). Open it from there, then turn them on.
            </div>
          ) : null}
          {msg ? <div className="mt-2 font-mono text-micro text-muted">{msg}</div> : null}
          <div className="mt-2 font-mono text-micro text-subtle">
            After owner rollout verification, paper-fill alerts fire when a position books. Optional
            READ ONLY alerts report an unbooked direction and its recorded blockers, once per
            direction per window. A research alert is never a fill or follower instruction. Alerts
            are per browser — turn them on wherever you want them.
          </div>
        </>
      )}
    </section>
  );
}
