import { useEffect, useRef, useState } from "react";
import { useDesk } from "@/lib/desk/store";
import { newSoundCursor, observeDeskSounds, type DeskCue } from "@/lib/desk/desk-sound-events";
import { DEFAULT_DESK_VOLUME, DeskSoundPlayer, safeDeskVolume } from "@/lib/desk/desk-sound-player";

const VOLUME_KEY = "desk.sound.volume.v1";
const SEEN_KEY = "desk.sound.seen.v1";
const PREVIEWS: readonly [DeskCue, string][] = [
  ["chair-up", "Chair UP"], ["chair-down", "Chair DOWN"],
  ["paper-fill", "Paper fill"], ["settlement", "Settlement"],
];

/** One read-only observer on the live desk, not on replays or training pages. */
export function DeskSoundControl({ active = true }: { active?: boolean }) {
  const frame = useDesk();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_DESK_VOLUME);
  const [focused, setFocused] = useState(false);
  const [message, setMessage] = useState("");
  const player = useRef<DeskSoundPlayer | null>(null);
  const cursor = useRef(newSoundCursor());
  const operation = useRef(0);
  const previewUntil = useRef(0);
  const panel = useRef<HTMLDetailsElement>(null);
  const options = useRef<HTMLElement>(null);
  const persisted = useRef("");
  const volumeNow = useRef(volume);
  volumeNow.current = volume;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(VOLUME_KEY);
      if (stored !== null) setVolume(safeDeskVolume(Number(stored)));
    } catch { /* storage is optional */ }
    try { cursor.current = newSoundCursor(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]")); } catch { /* private mode */ }
    const visibility = () => {
      cursor.current.ready = false;
      const live = !document.hidden && document.hasFocus();
      setFocused(live);
      if (!live) { previewUntil.current = 0; player.current?.stop(); }
    };
    const close = () => { if (panel.current) panel.current.open = false; };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && panel.current?.open) { close(); options.current?.focus(); }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) close();
    };
    visibility();
    window.addEventListener("focus", visibility);
    window.addEventListener("blur", visibility);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => {
      operation.current++;
      player.current?.dispose();
      player.current = null;
      window.removeEventListener("focus", visibility);
      window.removeEventListener("blur", visibility);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
    };
  }, []);

  useEffect(() => {
    const now = Date.now();
    const audible = enabled && focused && active && volume > 0 && Boolean(player.current?.isRunning());
    const events = observeDeskSounds(cursor.current, frame, now, audible);
    for (const event of events) {
      try { player.current?.play(event.kind, volume); } catch { setMessage("Sound could not play. Try enabling it again."); }
    }
    if (!audible && now >= previewUntil.current) player.current?.stop();
    const saved = JSON.stringify([...cursor.current.seen]);
    if (saved !== persisted.current) {
      persisted.current = saved;
      try { sessionStorage.setItem(SEEN_KEY, saved); } catch { /* in-memory dedup still works */ }
    }
  }, [frame, enabled, focused, active, volume]);

  const mute = () => {
    operation.current++;
    setEnabled(false);
    setBusy(false);
    setMessage("");
    cursor.current.ready = false;
    previewUntil.current = 0;
    player.current?.stop();
  };
  const enableOrPreview = async (cue?: DeskCue) => {
    const request = ++operation.current;
    setBusy(true);
    setMessage("");
    cursor.current.ready = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const audio = player.current ?? (player.current = new DeskSoundPlayer());
      // Create/resume AudioContext inside the explicit click, not on mount.
      await Promise.race([
        audio.unlock(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Sound permission timed out. Try again.")), 3000); }),
      ]);
      if (operation.current !== request) return;
      if (cue) {
        previewUntil.current = Date.now() + 800;
        audio.play(cue, volumeNow.current);
        setMessage(volumeNow.current === 0 ? "Volume is muted. Raise it to hear a preview." : `Preview: ${PREVIEWS.find(([kind]) => kind === cue)?.[1]}`);
      } else {
        setEnabled(true);
        setMessage("Event sounds enabled. Existing events stay silent.");
      }
    } catch (error) {
      if (operation.current === request) {
        setEnabled(false);
        setMessage(error instanceof Error ? error.message : "Sound unavailable in this browser.");
      }
    } finally {
      clearTimeout(timeout);
      if (operation.current === request) setBusy(false);
    }
  };
  const changeVolume = (value: number) => {
    const next = safeDeskVolume(value);
    volumeNow.current = next;
    setVolume(next);
    player.current?.setVolume(next);
    if (next === 0) player.current?.stop();
    try { localStorage.setItem(VOLUME_KEY, String(next)); } catch { /* works for this visit */ }
  };
  const listening = enabled && active && focused && volume > 0;

  return (
    <div className="relative flex shrink-0 items-center font-mono text-micro" data-desk-sound data-sound-enabled={enabled}>
      <button type="button" aria-label="Desk event sounds" aria-pressed={enabled}
        title={enabled || busy ? "Mute desk sounds" : "Enable desk event sounds"}
        className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ${enabled ? "text-gold" : "text-muted"}`}
        onClick={() => enabled || busy ? mute() : void enableOrPreview()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4Z" />
          {enabled ? <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></> : <path d="m16 9 6 6m0-6-6 6" />}
        </svg>
        <span className="hidden sm:inline">Sound: {busy ? "…" : enabled ? "On" : "Off"}</span>
      </button>
      <details ref={panel} className="relative">
        <summary ref={options} aria-label="Sound settings and previews" title="Sound settings and previews"
          className="flex min-h-11 min-w-6 cursor-pointer list-none items-center justify-center rounded-md text-muted marker:content-none hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
          <span aria-hidden="true">▾</span>
        </summary>
        <div className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg border border-border-strong bg-surface p-4 text-fg shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
          <div><div className="uppercase tracking-widest text-gold">Desk sounds</div>
            <p className="mt-1 font-sans text-ui leading-snug text-muted">Brief cues for Chair reads, recorded paper fills and official settlements.</p></div>
          <label className="block"><span className="flex justify-between"><span>Volume</span><span>{volume}%</span></span>
            <input aria-label="Desk sound volume" type="range" min="0" max="100" step="1" value={volume}
              onChange={(e) => changeVolume(Number(e.target.value))} className="mt-1 min-h-6 w-full accent-gold" /></label>
          <div><div className="mb-1 text-subtle">Preview sounds</div>
            <div className="grid grid-cols-2 gap-1.5">{PREVIEWS.map(([kind, label]) =>
              <button key={kind} type="button" disabled={busy} onClick={() => void enableOrPreview(kind)}
                className="min-h-11 rounded-md border border-border px-2 text-left hover:border-border-strong hover:bg-surface-2 disabled:opacity-50"
                aria-label={`Preview ${label} sound`}>▷ {label}</button>)}</div>
          </div>
          <p className="font-sans text-ui leading-snug text-muted">{listening ? "On for this visit." : enabled ? "Paused outside the active live view, or while volume is muted." : "Off until you enable it. Volume is remembered."} Live Floor and Gallery only; no background, Demo, or replay alerts. Preview does not enable alerts.</p>
          <p role="status" aria-live="polite" className="font-sans text-ui text-gold">{message}</p>
        </div>
      </details>
    </div>
  );
}
