import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, Settings, X } from "lucide-react";
import {
  formatRemain,
  leanToStance,
  stanceWord,
  tapeFromLog,
} from "@/lib/atelier/calls";
import {
  ROOMS,
  defaultParams,
  roomById,
  type Params,
  type RoomId,
} from "@/lib/atelier/catalog";
import { CALL_GLOW } from "@/lib/atelier/palette";
import { formatSeed, nextSeed } from "@/lib/atelier/rng";
import { useStudio } from "@/lib/atelier/studio";
import type { CallLogRow, Lean } from "@/lib/desk/types";

const STORE = "atelier:v3";
const WINDOW_MS = 15 * 60 * 1000;

export type SatoshiPaint = {
  lean: Lean;
  remainingMs: number;
  ticker: string;
  log: CallLogRow[];
};

function emptyBag(): Record<RoomId, Params> {
  const bag = {} as Record<RoomId, Params>;
  for (const r of ROOMS) bag[r.id] = defaultParams(r);
  return bag;
}

export function Gallery({ satoshi }: { satoshi: SatoshiPaint }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bounceRef = useRef<HTMLCanvasElement>(null);
  const roomRef = useRef<RoomId>("field");
  const [roomId, setRoomId] = useState<RoomId>("field");
  const [seed, setSeed] = useState(20260905);
  const [paused, setPaused] = useState(false);
  const [bag, setBag] = useState<Record<RoomId, Params>>(emptyBag);
  const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState(false);
  const [full, setFull] = useState(false);
  const [ready, setReady] = useState(false);

  const stance = leanToStance(satoshi.lean);
  const remaining = Math.max(0, satoshi.remainingMs);
  const progress = 1 - remaining / WINDOW_MS;
  const tape = tapeFromLog(satoshi.log, stance, satoshi.ticker);

  roomRef.current = roomId;
  const room = roomById(roomId);
  const params: Params = {
    ...(bag[roomId] ?? defaultParams(room)),
    call: stance,
    stance,
    remain: Math.max(0, 1 - progress),
    clock: formatRemain(remaining),
  };

  const glow = CALL_GLOW[stance];

  const setParam = useCallback((key: string, value: string | number) => {
    if (key === "stance" || key === "call") return;
    const id = roomRef.current;
    setBag((prev) => ({
      ...prev,
      [id]: { ...prev[id], [key]: value },
    }));
  }, []);

  const host = useMemo(() => ({ setParam }), [setParam]);

  useStudio(canvasRef, bounceRef, roomId, params, seed, paused, host);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE) ?? localStorage.getItem("atelier:v2");
      if (!raw) return;
      const saved = JSON.parse(raw) as { room?: string; seed?: number; bag?: Record<string, Params> };
      if (saved.room && ROOMS.some((r) => r.id === saved.room)) setRoomId(saved.room as RoomId);
      if (typeof saved.seed === "number") setSeed(saved.seed >>> 0);
      if (saved.bag) {
        setBag((prev) => {
          const next = { ...prev };
          for (const r of ROOMS) {
            if (saved.bag && saved.bag[r.id]) {
              const merged = { ...next[r.id], ...saved.bag[r.id] };
              delete merged.stance;
              delete merged.call;
              next[r.id] = merged;
            }
          }
          return next;
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ room: roomId, seed, bag }));
    } catch {
      /* ignore */
    }
  }, [roomId, seed, bag]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        if (settings) {
          setSettings(false);
          return;
        }
        if (full) setFull(false);
        return;
      }
      if (e.key >= "1" && e.key <= "3") {
        const r = ROOMS[Number(e.key) - 1];
        if (r) setRoomId(r.id);
      } else if (e.key === "r" || e.key === "R") {
        setSeed((s) => nextSeed(s));
      } else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "f" || e.key === "F") {
        setFull((v) => !v);
      } else if (e.key === "," || e.key === "s" || e.key === "S") {
        if (e.key === "s" && (e.metaKey || e.ctrlKey)) return;
        setSettings((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings, full]);

  const copySeed = async () => {
    try {
      await navigator.clipboard.writeText(formatSeed(seed));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  const recent = tape.slice(-12);
  const word = stanceWord(stance);

  return (
    <div
      className={`atelier${full ? " is-full" : ""}${settings ? " is-sheet" : ""}`}
      id="room"
      style={{ ["--glow" as string]: glow }}
    >
      <div className="atelier-spot" />
      <header className="atelier-mast">
        <div className="atelier-mark">
          Atelier <span className="atelier-mark-rest">· SATOSHI</span>
        </div>
        <div className="atelier-live" aria-live="polite">
          <span className="atelier-live-word">{word}</span>
          <span className="atelier-sr">{formatRemain(remaining)}</span>
        </div>
      </header>

      <div className="atelier-dock">
        <button
          type="button"
          className="atelier-iconbtn"
          aria-pressed={full}
          aria-label={full ? "Exit full screen" : "Full screen art"}
          onClick={() => setFull((v) => !v)}
        >
          {full ? <Minimize2 size={16} strokeWidth={1.75} /> : <Maximize2 size={16} strokeWidth={1.75} />}
        </button>
        <button
          type="button"
          className="atelier-iconbtn"
          aria-pressed={settings}
          aria-haspopup="dialog"
          aria-expanded={settings}
          aria-label="Settings"
          onClick={() => setSettings((v) => !v)}
        >
          <Settings size={16} strokeWidth={1.75} />
        </button>
      </div>

      <div className="atelier-stage">
        <div className="atelier-piece">
          <div className="atelier-frame" id="frame">
            <canvas
              ref={canvasRef}
              width={800}
              height={1000}
              aria-label={`${room.name} of SATOSHI ${word}`}
            />
            <div className="atelier-tooth" />
            <div className="atelier-bounce" aria-hidden="true">
              <canvas ref={bounceRef} width={800} height={1000} />
            </div>
          </div>
          <div className="atelier-plaque">
            <div className="title">
              {room.index} · {room.name} · {word}
            </div>
            <div className="meta">
              SATOSHI · {satoshi.ticker || "15m paper"} · not a trade
            </div>
            <div className="fine">{room.fine}</div>
          </div>
        </div>
      </div>

      {ready && settings ? (
        <button
          type="button"
          className="atelier-scrim"
          aria-label="Close settings"
          onClick={() => setSettings(false)}
        />
      ) : null}

      {ready ? (
        <aside
          className={`atelier-sheet${settings ? " is-open" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          aria-hidden={!settings}
          inert={!settings}
        >
          <div className="atelier-sheet-head">
            <div className="atelier-sheet-title">Settings</div>
            <button
              type="button"
              className="atelier-iconbtn"
              aria-label="Close settings"
              onClick={() => setSettings(false)}
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>

          <div className="atelier-tape" aria-label="Satoshi call tape">
            <div className="atelier-tape-bars">
              {recent.map((c, i) => (
                <i
                  key={`${c.label}-${c.at}-${i}`}
                  data-stance={c.stance}
                  className={i === recent.length - 1 ? "live" : undefined}
                  title={`${c.label} ${stanceWord(c.stance)}`}
                />
              ))}
            </div>
            <div className="atelier-tape-track" aria-hidden="true">
              <span style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
            </div>
          </div>

          <div className="atelier-param-label">
            <span>Room</span>
          </div>
          <div className="atelier-pills" role="tablist" aria-label="Rooms">
            {ROOMS.map((r) => (
              <button
                key={r.id}
                type="button"
                className="atelier-pill"
                role="tab"
                aria-pressed={r.id === roomId}
                onClick={() => setRoomId(r.id)}
              >
                {r.word.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="atelier-params">
            {room.params.map((p) =>
              p.kind === "enum" ? null : (
                <label key={p.key} className="atelier-param">
                  <span className="atelier-param-label">
                    <span>{p.label}</span>
                    <span className="atelier-param-val">
                      {p.format ? p.format(Number(params[p.key])) : params[p.key]}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={Number(params[p.key])}
                    onChange={(e) => setParam(p.key, Number(e.target.value))}
                    suppressHydrationWarning
                  />
                </label>
              ),
            )}
          </div>

          <div className="atelier-pills">
            <button type="button" className="atelier-pill" onClick={() => setSeed((s) => nextSeed(s))}>
              Reseed
            </button>
            <button
              type="button"
              className="atelier-pill"
              aria-pressed={paused}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? "Live" : "Pause"}
            </button>
            <button type="button" className="atelier-seed" onClick={copySeed} aria-label="Copy seed">
              {copied ? "Copied" : formatSeed(seed)}
            </button>
          </div>

          <p className="atelier-hint">{room.hint} · F full · 1–3 rooms · Esc close</p>
        </aside>
      ) : null}
    </div>
  );
}
