import { createContext, useContext, useEffect, useState } from "react";
import {
  getFrame,
  startEngine,
  stopEngine,
  subscribe,
  type DeskFrame,
} from "./engine";

let started = false;

export const InitialDeskFrame = createContext<DeskFrame | null>(null);

export function useDesk(): DeskFrame {
  const initial = useContext(InitialDeskFrame);
  const [frame, setFrame] = useState<DeskFrame>(() => initial ?? getFrame());
  useEffect(() => {
    const unsub = subscribe((next) => setFrame((current) =>
      !next.snap && current.snap && next.settings.source === "live"
        ? { ...current, lastError: next.lastError }
        : next,
    ));
    if (!started) {
      started = true;
      startEngine();
    }
    // Demo may emit synchronously during startEngine; subscribe before starting.
    const current = getFrame();
    if (current.snap) setFrame(current);
    return () => {
      unsub();
    };
  }, []);
  useEffect(() => {
    return () => {
      /* keep engine alive across tab switches */
    };
  }, []);
  return frame;
}

export function teardownDesk() {
  stopEngine();
  started = false;
}
