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
  | "pit_tour_done"
  /** UI-only: the Pro Floor's Core/Full desk switch. Carries no trading intent. */
  | "floor_density_toggle"
  /** UI-only: the Pro Floor's full gate checklist was opened. */
  | "floor_gates_expand"
  /**
   * THE NEW-USER FUNNEL. Navigation only: which door someone chose, whether a
   * Guided reader graduated to Pro or to training, and whether anyone looks at
   * the record or copies a window.
   *
   * Every one of these is a name and nothing else — the payload below is
   * `{ event }` and has never carried anything about the visitor. None of them
   * names a market action, a side, a price, an amount or an intent to act,
   * because this desk has no execution path for such an intent to reach. They answer
   * five product questions and cannot answer anything about a person.
   */
  | "home_guided_click"
  | "home_pro_click"
  | "floor_guided_open"
  | "floor_pro_open"
  | "guided_to_pro"
  | "guided_to_wick"
  | "window_replay_open"
  | "results_open"
  | "window_copy"
  | "record_copy";

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
