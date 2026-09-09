/** Shared canvas plumbing for the desk's charts: the palette, a
 *  device-pixel-aware draw hook that repaints on resize, and a rounded fill. */
import { useEffect, useRef } from "react";

export const UP = "#3fae7a";
export const DOWN = "#d15b4a";
export const WAIT = "#c4a574";
export const GRID = "#1f2128";
export const FG = "#9a958b";
export const LINE = "#c4a574";
export const BG = "#12141a";
export const INK = "#0b0c10";
export const FONT = "500 11px 'IBM Plex Mono', ui-monospace, monospace";
export const FONT_SM = "500 9px 'IBM Plex Mono', ui-monospace, monospace";

export function useDraw(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, dep: unknown) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const paint = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth || 320;
      const h = c.clientHeight || 140;
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawRef.current(ctx, w, h);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(c);
    return () => ro.disconnect();
  }, [dep]);
  return ref;
}

export function fillRound(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 2) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
