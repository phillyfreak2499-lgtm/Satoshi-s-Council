import { useEffect, useState } from "react";
import { Tip } from "./Tip";
import { readMotion, setMotion } from "./prefs";

/** SETTINGS → Display: motion preference for this browser only. */
export function DisplayPanel() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => setReduce(readMotion()), []);
  const set = (v: boolean) => {
    setReduce(v);
    setMotion(v);
  };
  return (
    <section className="rounded-md border border-border bg-surface p-3">
      <h3 className="mb-3 font-mono text-micro uppercase tracking-widest text-subtle">
        <Tip k="settings.display">Display</Tip>
      </h3>
      <label className="mb-2 flex min-h-11 items-center justify-between gap-2 font-mono text-ui text-muted">
        Reduce motion
        <input type="checkbox" checked={reduce} onChange={(e) => set(e.target.checked)} className="size-4" />
      </label>
      <div className="font-mono text-micro text-subtle">
        Turns off non-essential animation: pulses, chart eases, tooltip pops. Your system&apos;s reduce-motion setting is always respected too.
      </div>
    </section>
  );
}
