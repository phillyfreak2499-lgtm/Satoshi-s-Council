import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * The frame loop is on demand. Ambient life asks for a frame ~20× a second (2.5×
 * under reduced motion), the camera rig asks for more only while it travels, and a
 * hidden tab asks for nothing. Nothing here allocates per frame.
 */
export function Ticker({ paused, reduced, onReady }: { paused: boolean; reduced: boolean; onReady: () => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const ready = useRef(false);
  useEffect(() => {
    if (paused) return;
    invalidate();
    const id = window.setInterval(() => invalidate(), reduced ? 400 : 50);
    return () => window.clearInterval(id);
  }, [paused, reduced, invalidate]);
  useFrame(() => {
    if (!ready.current) {
      ready.current = true;
      onReady();
    }
    if (import.meta.env.DEV) {
      const r = gl.info.render;
      (window as unknown as { __chamber?: unknown }).__chamber = {
        calls: r.calls,
        triangles: r.triangles,
        dpr: gl.getPixelRatio(),
        frame: r.frame,
      };
    }
  });
  return null;
}
