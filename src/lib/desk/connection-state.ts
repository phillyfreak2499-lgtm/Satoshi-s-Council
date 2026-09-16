import type { DeskFrame } from "./engine";

export type ConnectionNotice = { title: string; detail: string };

/** Viewer status only. Never changes a Chair read, paper call, or feed timestamp. */
export function connectionNotice(frame: DeskFrame, now: number, online: boolean): ConnectionNotice | null {
  if (frame.settings.source !== "live") return null;
  const held = frame.snap
    ? "Showing the last received desk snapshot. Updates will resume automatically."
    : "Waiting for the first live desk snapshot. Retrying automatically.";
  if (!online) return { title: "Connection lost", detail: `Your browser is offline. ${held}` };
  if (frame.connection_error) return { title: "Reconnecting to the live desk", detail: held };
  const ageMs = frame.frame_at > 0 && now > 0 ? Math.max(0, now - frame.frame_at) : 0;
  const stalled = frame.brain_age_s != null && frame.brain_age_s + ageMs / 1000 > 30;
  if (ageMs > Math.max(15_000, frame.settings.poll_ms * 3) || stalled) {
    return { title: "Desk updates delayed", detail: held };
  }
  if (!frame.snap) return { title: "Connecting to the live desk", detail: "Waiting for the first live desk snapshot." };
  return null;
}
