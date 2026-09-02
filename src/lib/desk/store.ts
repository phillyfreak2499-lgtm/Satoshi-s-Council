import { useEffect, useState } from "react";
import {
  getFrame,
  startEngine,
  stopEngine,
  subscribe,
  type DeskFrame,
} from "./engine";

let started = false;

export function useDesk(): DeskFrame {
  const [frame, setFrame] = useState<DeskFrame>(() => getFrame());
  useEffect(() => {
    if (!started) {
      started = true;
      startEngine();
    }
    const unsub = subscribe(setFrame);
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
