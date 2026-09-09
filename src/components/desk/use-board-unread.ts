import { useEffect, useState } from "react";
import { listBoard } from "@/lib/desk/board";

/** How many board posts this viewer has seen, banked in localStorage. */
export const SEEN_KEY = "satoshi-desk-v1-board-seen";

function loadSeen() {
  if (typeof window === "undefined") return 0;
  try {
    return Number(localStorage.getItem(SEEN_KEY) || 0) || 0;
  } catch {
    return 0;
  }
}

/**
 * Unread board posts, for the BOARD tab's badge: how many posts have appeared
 * since this viewer last had the board open. Zero while the board tab is open
 * (and the seen-count is banked as fresh posts arrive), so the badge clears the
 * moment it is read. Polls faster while the board is the active tab.
 */
export function useBoardUnread(active?: boolean) {
  const [n, setN] = useState(0);
  const [seen, setSeen] = useState(loadSeen);

  useEffect(() => {
    const tick = async () => {
      try {
        const rows = await listBoard();
        setN(rows.length);
      } catch {
        /* board down */
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), active ? 4000 : 10000);
    return () => window.clearInterval(t);
  }, [active]);

  useEffect(() => {
    if (active) {
      setSeen(n);
      try {
        localStorage.setItem(SEEN_KEY, String(n));
      } catch {
        /* quota */
      }
    }
  }, [active, n]);

  return !active && n > seen ? n - seen : 0;
}
