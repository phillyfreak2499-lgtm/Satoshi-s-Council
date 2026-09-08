/** Fire-and-forget page events for the first-party counter. Nothing about
 *  the visitor travels with them; a counter must never break a page. */
export type BeaconEvent =
  | "room_view"
  | "desk_view"
  | "tour_start"
  | "tour_done"
  | "gloss_open"
  | "welcome_tour"
  | "welcome_floor"
  | "palette_open"
  | "share"
  | "settle_alert"
  | "pit_tour_start"
  | "pit_tour_done";

export function beacon(event: BeaconEvent, oncePerSession = false): void {
  try {
    if (typeof window === "undefined") return;
    if (oncePerSession) {
      const key = `beacon.seen:${event}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    }
    const body = JSON.stringify({ event });
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/beacon", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/beacon", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* private mode, blocked storage, old browsers: fine */
  }
}
