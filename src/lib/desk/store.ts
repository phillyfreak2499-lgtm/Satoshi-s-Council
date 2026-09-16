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
      !next.snap && current.snap && current.settings.source === "live" && next.settings.source === "live"
        ? { ...current, lastError: next.lastError, connection_error: next.connection_error, ticking: next.ticking }
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
