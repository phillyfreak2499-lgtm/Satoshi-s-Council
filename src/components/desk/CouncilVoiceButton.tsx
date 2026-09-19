import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Square, Volume2 } from "lucide-react";
import type { CouncilVoiceSource, CouncilVoiceSpeaker } from "@/lib/desk/council-voice";

type VoiceState = "idle" | "loading" | "playing" | "error";

let activeAudio: HTMLAudioElement | null = null;

export function CouncilVoiceButton({
  source,
  speaker,
  eventKey,
  label,
  className = "",
}: {
  source: CouncilVoiceSource;
  speaker: CouncilVoiceSpeaker;
  eventKey?: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<VoiceState>("idle");
  const mine = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      const audio = mine.current;
      if (audio) {
        audio.pause();
        audio.src = "";
        if (activeAudio === audio) activeAudio = null;
      }
    },
    [],
  );

  const stop = () => {
    const audio = mine.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      if (activeAudio === audio) activeAudio = null;
    }
    setState("idle");
  };

  const play = async () => {
    if (state === "playing" || state === "loading") {
      stop();
      return;
    }
    activeAudio?.pause();

    const query = new URLSearchParams({ source, speaker });
    if (eventKey) query.set("event", eventKey);
    const audio = new Audio(`/council-voice?${query.toString()}`);
    audio.preload = "none";
    mine.current = audio;
    activeAudio = audio;
    setState("loading");

    audio.addEventListener("playing", () => setState("playing"), { once: true });
    audio.addEventListener(
      "ended",
      () => {
        if (activeAudio === audio) activeAudio = null;
        setState("idle");
      },
      { once: true },
    );
    audio.addEventListener(
      "error",
      () => {
        if (activeAudio === audio) activeAudio = null;
        setState("error");
      },
      { once: true },
    );

    try {
      await audio.play();
    } catch {
      if (activeAudio === audio) activeAudio = null;
      setState("error");
    }
  };

  const text =
    state === "loading"
      ? "Loading voice"
      : state === "playing"
        ? "Stop"
        : state === "error"
          ? "Voice unavailable"
          : label ?? `Hear ${speaker}`;

  return (
    <button
      type="button"
      onClick={() => void play()}
      aria-pressed={state === "playing"}
      aria-label={text}
      title={state === "error" ? "AI voice is temporarily unavailable" : "AI-generated character voice"}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-sm border border-border bg-canvas px-2.5 py-1 font-mono text-micro uppercase tracking-widest text-muted transition hover:border-border-strong hover:text-fg disabled:opacity-60 ${className}`}
    >
      {state === "loading" ? (
        <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
      ) : state === "playing" ? (
        <Square size={12} aria-hidden="true" />
      ) : (
        <Volume2 size={14} aria-hidden="true" />
      )}
      <span>{text}</span>
    </button>
  );
}
