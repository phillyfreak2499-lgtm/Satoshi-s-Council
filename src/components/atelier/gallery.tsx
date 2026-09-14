import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, RefreshCw, Settings, X } from "lucide-react";
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

const STORE = "atelier:v4";
const WINDOW_MS = 15 * 60 * 1000;

export type SatoshiPaint = {
  lean: Lean;
  remainingMs: number;
  ticker: string;
  phase: string;
  confidence: number;
  score: number;
  bar: number;
  brainAge: number | null;
  source: string;
  log: CallLogRow[];
};

function emptyBag(): Record<RoomId, Params> {
  const bag = {} as Record<RoomId, Params>;
  for (const room of ROOMS) bag[room.id] = defaultParams(room);
  return bag;
}

function hashWindow(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function Gallery({ satoshi }: { satoshi: SatoshiPaint }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bounceRef = useRef<HTMLCanvasElement>(null);
  const roomRef = useRef<RoomId>("field");
  const fullRef = useRef(false);
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
  const progress = clamp01(1 - remaining / WINDOW_MS);
  const tape = tapeFromLog(satoshi.log, stance, satoshi.ticker);
  const artSeed = useMemo(
    () => (seed ^ hashWindow(satoshi.ticker || "15m")) >>> 0,
    [seed, satoshi.ticker],
  );

  roomRef.current = roomId;
  fullRef.current = full;
  const room = roomById(roomId);
  const params: Params = {
    ...(bag[roomId] ?? defaultParams(room)),
    call: stance,
    stance,
    remain: Math.max(0, 1 - progress),
    clock: formatRemain(remaining),
  };

  const glow = CALL_GLOW[stance];
  const word = stanceWord(stance);
  const confidence = Math.min(100, Math.max(0, Math.round(satoshi.confidence)));
  const voteStrength = satoshi.bar > 0 ? clamp01(Math.abs(satoshi.score) / satoshi.bar) : 0;
  const liveSource = satoshi.source === "live";
  const feedFresh = liveSource && satoshi.brainAge != null && satoshi.brainAge < 20;
  const feedLabel = liveSource ? (feedFresh ? "Live feed" : "Feed aging") : "Demo feed";

  const setParam = useCallback((key: string, value: string | number) => {
    if (key === "stance" || key === "call") return;
    const id = roomRef.current;
    setBag((prev) => ({
      ...prev,
      [id]: { ...prev[id], [key]: value },
    }));
  }, []);

  const host = useMemo(() => ({ setParam }), [setParam]);

  useStudio(canvasRef, bounceRef, roomId, params, artSeed, paused, host);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(STORE) ??
        localStorage.getItem("atelier:v3") ??
        localStorage.getItem("atelier:v2");
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        room?: string;
        seed?: number;
        bag?: Record<string, Params>;
      };
      if (saved.room && ROOMS.some((candidate) => candidate.id === saved.room)) {
        setRoomId(saved.room as RoomId);
      }
      if (typeof saved.seed === "number") setSeed(saved.seed >>> 0);
      if (saved.bag) {
        setBag((prev) => {
          const next = { ...prev };
          for (const candidate of ROOMS) {
            if (saved.bag && saved.bag[candidate.id]) {
              const merged = { ...next[candidate.id], ...saved.bag[candidate.id] };
              delete merged.stance;
              delete merged.call;
              next[candidate.id] = merged;
            }
          }
          return next;
        });
      }
    } catch {
      /* ignore invalid local preferences */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ room: roomId, seed, bag }));
    } catch {
      /* ignore storage failures */
    }
  }, [roomId, seed, bag]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setFull(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFull = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        setFull(false);
      }
      return;
    }

    if (fullRef.current) {
      setFull(false);
      return;
    }

    const root = rootRef.current;
    if (!root?.requestFullscreen) {
      setFull(true);
      return;
    }

    try {
      await root.requestFullscreen();
      setFull(true);
    } catch {
      setFull(true);
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "Escape") {
        if (settings) {
          setSettings(false);
          return;
        }
        if (fullRef.current && !document.fullscreenElement) setFull(false);
        return;
      }
      if (event.key >= "1" && event.key <= "3") {
        const nextRoom = ROOMS[Number(event.key) - 1];
        if (nextRoom) setRoomId(nextRoom.id);
      } else if (event.key === "r" || event.key === "R") {
        setSeed((current) => nextSeed(current));
      } else if (event.key === " ") {
        event.preventDefault();
        setPaused((current) => !current);
      } else if (event.key === "f" || event.key === "F") {
        void toggleFull();
      } else if (event.key === "," || event.key === "s" || event.key === "S") {
        if (event.key === "s" && (event.metaKey || event.ctrlKey)) return;
        setSettings((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings, toggleFull]);

  const copySeed = async () => {
    try {
      await navigator.clipboard.writeText(formatSeed(artSeed));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore clipboard failures */
    }
  };

  const recent = tape.slice(-12);

  return (
    <div
      ref={rootRef}
      className={`atelier${full ? " is-full" : ""}${settings ? " is-sheet" : ""}`}
      id="room"
      data-stance={stance}
      data-feed={feedFresh ? "fresh" : liveSource ? "aging" : "demo"}
      style={{ ["--glow" as string]: glow }}
    >
      <div className="atelier-spot" />
      <header className="atelier-mast">
        <div className="atelier-mark">
          Signal Gallery <span className="atelier-mark-rest">· SATOSHI</span>
        </div>
        <div className="atelier-live" aria-live="polite">
          <span className="atelier-live-word">{word}</span>
          <span className="atelier-live-clock">{formatRemain(remaining)}</span>
        </div>
      </header>

      <div className="atelier-dock">
        <button
          type="button"
          className="atelier-iconbtn"
          aria-pressed={full}
          aria-label={full ? "Exit display mode" : "Enter display mode"}
          onClick={() => void toggleFull()}
        >
          {full ? (
            <Minimize2 size={16} strokeWidth={1.75} />
          ) : (
            <Maximize2 size={16} strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          className="atelier-iconbtn"
          aria-label="Regenerate artwork"
          onClick={() => setSeed((current) => nextSeed(current))}
        >
          <RefreshCw size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="atelier-iconbtn"
          aria-pressed={settings}
          aria-haspopup="dialog"
          aria-expanded={settings}
          aria-label="Gallery settings"
          onClick={() => setSettings((current) => !current)}
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
              aria-label={`${room.name} showing SATOSHI ${word}`}
            />
            <div className="atelier-tooth" />
            <div className="atelier-bounce" aria-hidden="true">
              <canvas ref={bounceRef} width={800} height={1000} />
            </div>
          </div>
        </div>
      </div>

      <section
        className="atelier-signal"
        aria-label={`SATOSHI ${word}, ${formatRemain(remaining)} remaining`}
      >
        <div className="atelier-signal-topline">
          <span className="atelier-signal-status">
            <i aria-hidden="true" />
            {feedLabel}
          </span>
          <span>
            {room.index} / {room.name}
          </span>
        </div>
        <div className="atelier-signal-call">
          <strong>{word}</strong>
          <time>{formatRemain(remaining)}</time>
        </div>
        <div className="atelier-signal-meter" aria-hidden="true">
          <span style={{ width: `${Math.round(voteStrength * 100)}%` }} />
        </div>
        <div className="atelier-signal-meta">
          <span>gate confidence {confidence}</span>
          <span>
            weighted vote {Math.abs(satoshi.score).toFixed(2)} / {Math.max(0, satoshi.bar).toFixed(2)}
          </span>
        </div>
        <div className="atelier-signal-tape" aria-label="Recent SATOSHI calls">
          {recent.map((call, index) => (
            <i
              key={`${call.label}-${call.at}-${index}`}
              data-stance={call.stance}
              className={index === recent.length - 1 ? "live" : undefined}
              title={`${call.label} ${stanceWord(call.stance)}`}
            />
          ))}
        </div>
        <div className="atelier-signal-foot">
          <span title={satoshi.ticker}>{satoshi.ticker || "15m paper"}</span>
          <span>{satoshi.phase || "—"} · paper only · not a trade</span>
        </div>
      </section>

      {ready && settings ? (
        <button
          type="button"
          className="atelier-scrim"
          aria-label="Close gallery settings"
          onClick={() => setSettings(false)}
        />
      ) : null}

      {ready ? (
        <aside
          className={`atelier-sheet${settings ? " is-open" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label="Gallery settings"
          aria-hidden={!settings}
          inert={!settings}
        >
          <div className="atelier-sheet-head">
            <div className="atelier-sheet-title">Gallery settings</div>
            <button
              type="button"
              className="atelier-iconbtn"
              aria-label="Close gallery settings"
              onClick={() => setSettings(false)}
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>

          <div className="atelier-tape" aria-label="Satoshi call tape">
            <div className="atelier-tape-bars">
              {recent.map((call, index) => (
                <i
                  key={`${call.label}-${call.at}-${index}`}
                  data-stance={call.stance}
                  className={index === recent.length - 1 ? "live" : undefined}
                  title={`${call.label} ${stanceWord(call.stance)}`}
                />
              ))}
            </div>
            <div className="atelier-tape-track" aria-hidden="true">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>

          <div className="atelier-param-label">
            <span>Room</span>
          </div>
          <div className="atelier-pills" role="tablist" aria-label="Rooms">
            {ROOMS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className="atelier-pill"
                role="tab"
                aria-pressed={candidate.id === roomId}
                onClick={() => setRoomId(candidate.id)}
              >
                {candidate.word.toUpperCase()}
              </button>
            ))}
          </div>

          <p className="atelier-room-copy">{room.fine}</p>

          <div className="atelier-params">
            {room.params.map((param) =>
              param.kind === "enum" ? null : (
                <label key={param.key} className="atelier-param">
                  <span className="atelier-param-label">
                    <span>{param.label}</span>
                    <span className="atelier-param-val">
                      {param.format ? param.format(Number(params[param.key])) : params[param.key]}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={Number(params[param.key])}
                    onChange={(event) => setParam(param.key, Number(event.target.value))}
                    suppressHydrationWarning
                  />
                </label>
              ),
            )}
          </div>

          <div className="atelier-pills">
            <button
              type="button"
              className="atelier-pill"
              onClick={() => setSeed((current) => nextSeed(current))}
            >
              New edition
            </button>
            <button
              type="button"
              className="atelier-pill"
              aria-pressed={paused}
              onClick={() => setPaused((current) => !current)}
            >
              {paused ? "Live" : "Pause"}
            </button>
            <button type="button" className="atelier-seed" onClick={copySeed} aria-label="Copy art seed">
              {copied ? "Copied" : formatSeed(artSeed)}
            </button>
          </div>

          <p className="atelier-hint">{room.hint} · F display · 1–3 rooms · R new edition</p>
        </aside>
      ) : null}
    </div>
  );
}
