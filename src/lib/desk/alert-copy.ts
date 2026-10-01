/** Owner-approved copy. Keep titles, messages and badge geometry exact. */
export function closeCT(close: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(close);
}
export function paperAlert(side: "UP" | "DOWN", entry: number, close: number) {
  return {
    title: `PAPER POSITION BOOKED · ${side}`,
    body: `Paper ${side} position booked at ${entry}¢. Window closes ${closeCT(close)} CT. Paper only — no live order.`,
    icon: "/alerts/booked.png",
    badge: "/alerts/booked.png",
    tier: "paper-fill",
    badgeLabel: "BOOKED",
  };
}
export function readAlert(side: "UP" | "DOWN", reason: string, close: number) {
  return {
    title: `DIRECTIONAL READ ONLY · ${side}`,
    body: `Chair reads ${side}. No paper position booked: ${reason}. Window closes ${closeCT(close)} CT. Research read only — not a fill or follower entry signal.`,
    icon: "/alerts/read-only.png",
    badge: "/alerts/read-only.png",
    tier: "directional-read",
    badgeLabel: "READ ONLY",
  };
}
