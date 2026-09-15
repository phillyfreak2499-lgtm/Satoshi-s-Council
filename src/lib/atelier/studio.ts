import { useEffect, useRef } from "react";
import { FACTORIES } from "./rooms";
import type { Params, RoomId } from "./catalog";
import type { RoomHost, RoomWorld } from "./world";

export function useStudio(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  bounceRef: React.RefObject<HTMLCanvasElement | null>,
  roomId: RoomId,
  params: Params,
  seed: number,
  paused: boolean,
  host: RoomHost,
) {
  const paramsRef = useRef(params);
  const hostRef = useRef(host);
  const pausedRef = useRef(paused);
  const seedRef = useRef(seed);
  paramsRef.current = params;
  hostRef.current = host;
  pausedRef.current = paused;
  seedRef.current = seed;

  useEffect(() => {
    if (roomId === "streamer") return;
    const factory = FACTORIES[roomId];
    const canvas = canvasRef.current;
    const bounce = bounceRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    const bctx = bounce?.getContext("2d", { alpha: false }) ?? null;
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hostProxy: RoomHost = {
      setParam(key, value) {
        hostRef.current.setParam(key, value);
      },
    };

    let world: RoomWorld | null = null;
    let raf = 0;
    let last = performance.now();
    let alive = true;
    let bw = canvas.width;
    let bh = canvas.height;

    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      const changed = canvas.width !== w || canvas.height !== h;
      if (changed) {
        canvas.width = w;
        canvas.height = h;
        bw = w;
        bh = h;
      }
      if (bounce && (bounce.width !== w || bounce.height !== h)) {
        bounce.width = w;
        bounce.height = h;
      }
      return { w, h, changed };
    };

    const make = () => {
      const { w, h } = fit();
      bw = w;
      bh = h;
      world = factory(w, h, seedRef.current, paramsRef.current, hostProxy);
    };
    make();

    const onPointer = (kind: "down" | "move" | "up") => (e: PointerEvent) => {
      if (!world) return;
      if (kind === "move" && e.buttons === 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
      world.pointer(x, y, kind);
      if (kind === "down") {
        canvas.setPointerCapture(e.pointerId);
      }
    };

    const down = onPointer("down");
    const move = onPointer("move");
    const up = onPointer("up");
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    const ro = new ResizeObserver(() => {
      const { w, h, changed } = fit();
      if (changed) world?.resize(w, h);
    });
    ro.observe(canvas);

    const bounceOn = () => {
      if (!bounce) return false;
      return bounce.offsetParent !== null && bounce.clientHeight > 0;
    };

    const tick = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!world) {
        raf = requestAnimationFrame(tick);
        return;
      }
      world.setParams(paramsRef.current);
      const freeze = pausedRef.current || reduce;
      if (!freeze) world.step(dt, now);
      world.draw(ctx, bw, bh, now);
      if (bctx && bounce && bounceOn()) bctx.drawImage(canvas, 0, 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [canvasRef, bounceRef, roomId, seed]);
}
