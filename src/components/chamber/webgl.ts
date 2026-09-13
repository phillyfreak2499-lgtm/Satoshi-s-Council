/**
 * Capability probes for the Chamber. No three.js here: these run BEFORE the 3D
 * chunk is fetched, so a device that cannot render never downloads the renderer.
 *
 * WebGL2 only: the installed three (r186) WebGLRenderer creates a `webgl2` context
 * and has no WebGL1 path, so a device without WebGL2 gets the fallback page.
 */
export function probeWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return false;
    // Release the probe context so it never counts against the browser's context cap.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
/** Phones and small tablets: coarse pointer or a narrow viewport. */
export const MOBILE_LIKE = "(pointer: coarse), (max-width: 767px)";

export function mediaMatches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

/** Subscribe to a media query; returns the cleanup. */
export function watchMedia(query: string, onChange: (matches: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(query);
  const handler = (e: MediaQueryListEvent) => onChange(e.matches);
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}

/** Conservative device-pixel-ratio range: phones cap at 1.5, desktops at 2. */
export function dprFor(mobile: boolean): [number, number] {
  return mobile ? [1, 1.5] : [1, 2];
}
