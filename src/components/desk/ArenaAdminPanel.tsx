import { useState } from "react";
import { getAdminKey } from "@/lib/desk/engine";
import { Tip } from "./Tip";

/** SETTINGS → Arena: hide one callsign (the tool), or clear every callsign and paper lock (the last resort). Admin key. */
export function ArenaAdminPanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const hide = async () => {
    const key = getAdminKey();
    if (!key) {
      setMsg("enter the admin key above first");
      return;
    }
    const name = target.trim();
    if (!name) {
      setMsg("type the callsign to hide");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/arena/hide", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ key, name }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; hidden?: number } | null;
      if (!r.ok || !j?.ok) throw new Error(j?.error || `hide ${r.status}`);
      setTarget("");
      setMsg("hidden: the callsign now prints as a paper label; its locks stay on the private record");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    const key = getAdminKey();
    if (!key) {
      setMsg("enter the admin key above first");
      return;
    }
    if (!window.confirm("Delete every Arena callsign and paper lock? The boards start over. This cannot be undone.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/arena/reset", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ key }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; locks?: number; players?: number } | null;
      if (!r.ok || !j?.ok) throw new Error(j?.error || `reset ${r.status}`);
      setMsg(`cleared ${j.locks ?? 0} lock${j.locks === 1 ? "" : "s"} and ${j.players ?? 0} callsign${j.players === 1 ? "" : "s"}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-md border border-border bg-surface p-3">
      <h3 className="mb-3 font-mono text-micro uppercase tracking-widest text-subtle">
        <Tip k="settings.arena">Arena</Tip>
      </h3>
      <div className="mb-2 font-mono text-micro text-subtle">
        One callsign per name, three new callsigns per network a day, ranked after three settled locks, and a since date on every row.
      </div>
      <form
        className="mb-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void hide();
        }}
      >
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          maxLength={16}
          autoComplete="off"
          placeholder="callsign to hide"
          aria-label="callsign to hide"
          className="input input-sm font-mono"
        />
        <button type="submit" disabled={busy} className="btn btn-secondary btn-sm">
          {busy ? "working…" : "Hide one callsign"}
        </button>
        <span className="font-mono text-micro text-subtle">renames it to a paper label and keeps its locks · needs the admin key</span>
      </form>
      <button
        type="button"
        disabled={busy}
        onClick={() => void clear()}
        className="btn btn-danger"
      >
        {busy ? "clearing…" : "Clear the Arena"}
      </button>
      <span className="ml-2 font-mono text-micro text-subtle">last resort: deletes every callsign and paper lock · needs the admin key</span>
      {msg ? <div className="mt-2 font-mono text-micro text-muted">{msg}</div> : null}
    </section>
  );
}
