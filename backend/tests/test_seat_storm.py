"""Seat Storm: lock-wait mini. No orders, no Follower, no LAW/SICK start."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")


def _storm_js() -> str:
    start = JS.find("Seat Storm — pass-time after a Chair lock")
    end = JS.find("function wireFloorChairClicks()")
    assert start > 0
    assert end > start
    return JS[start:end]


class SeatStormMarkupTests(unittest.TestCase):
    def test_floor_and_table_prompts(self):
        self.assertIn('id="seatStormPrompt"', HTML)
        self.assertIn('id="seatStormTableBtn"', HTML)
        self.assertIn(">KILL TIME</button>", HTML)
        self.assertIn('id="seatStormPlay"', HTML)
        self.assertIn('id="ssStreak"', HTML)
        self.assertIn('id="ssBest"', HTML)
        self.assertIn('id="ssClock"', HTML)
        self.assertIn('id="ssExit"', HTML)
        self.assertIn("BACK TO DESK", HTML)
        self.assertIn('id="ssRing"', HTML)
        self.assertIn('id="ssStatus"', HTML)

    def test_hud_is_orbitron_chrome(self):
        self.assertIn("SEAT STORM", CSS)
        self.assertIn("font-family: Orbitron, monospace", CSS)
        self.assertIn(".ss-seat.ss-lit", CSS)
        self.assertIn(".ss-seat.ss-miss", CSS)
        self.assertIn("min-width: 44px", CSS)
        self.assertIn("min-height: 44px", CSS)
        self.assertIn("z-index: 85", CSS)
        self.assertIn("z-index: 88", CSS)


class SeatStormRulesTests(unittest.TestCase):
    def test_duration_is_30_to_45s_not_instant_replay(self):
        storm = _storm_js()
        m = re.search(r"SS_DURATION_MS = (\d+)", storm)
        self.assertIsNotNone(m)
        ms = int(m.group(1))
        self.assertGreaterEqual(ms, 30_000)
        self.assertLessEqual(ms, 45_000)
        self.assertNotEqual(ms, 3000)

    def test_last_n_matches_late_window(self):
        storm = _storm_js()
        m = re.search(r"SS_LAST_N_SEC = (\d+)", storm)
        self.assertIsNotNone(m)
        self.assertEqual(int(m.group(1)), 180)
        self.assertIn("ssLockedAndWaiting", storm)
        self.assertIn("WINDOW CLOSING — WATCH THE FINISH", storm)

    def test_law_and_sick_block_start(self):
        storm = _storm_js()
        self.assertIn("function ssDeskSick()", storm)
        self.assertIn("if (lawLocked()) return false;", storm)
        self.assertIn("if (ssDeskSick()) return false;", storm)
        self.assertIn("if (lawLocked() || ssDeskSick()) return;", storm)
        self.assertIn("sick_feed", storm)
        self.assertIn("law.lockdown", JS)

    def test_streak_and_session_best(self):
        storm = _storm_js()
        self.assertIn("council_seat_storm_best", storm)
        self.assertIn("sessionStorage.setItem(SS_BEST_KEY", storm)
        self.assertIn("MISS — STREAK BROKE", storm)
        self.assertIn("ss.streak = 0", storm)
        self.assertIn("ss.streak += 1", storm)

    def test_exits_esc_table_back_to_desk(self):
        self.assertIn('stopSeatStorm("esc")', JS)
        self.assertIn('stopSeatStorm("desk")', JS)
        self.assertIn("isSeatStormPlaying()", JS)
        self.assertIn("BACK TO DESK", HTML)
        self.assertIn('id="floorExitBtn"', HTML)

    def test_phone_one_table_44px(self):
        storm = _storm_js()
        self.assertIn("isPhoneDesk()", storm)
        self.assertIn("ssWatchTables", storm)
        self.assertIn("min-width: 44px", CSS)
        self.assertIn("min-height: 44px", CSS)


class SeatStormSafetyTests(unittest.TestCase):
    def test_storm_never_opens_follower_or_sends_orders(self):
        storm = _storm_js()
        self.assertNotIn('setMode("follower")', storm)
        self.assertNotIn("/api/follower", storm)
        self.assertNotIn("/api/follower/order", storm)
        self.assertNotIn("from_lock", storm)
        self.assertNotIn("SEND THIS LOCK LIVE", storm)
        self.assertNotIn("/api/paper", storm)
        self.assertNotIn("/api/kalshi", storm)
        self.assertNotIn("place_order", storm)
        self.assertNotIn("evaluate_order", storm)
        self.assertNotIn("create_order", storm)
        self.assertIn("Never opens Follower", storm)
        self.assertIn("Never sends Kalshi orders", storm)
        self.assertNotIn("storefront", storm.lower())
        self.assertNotIn("addToCart", storm)

    def test_start_does_not_change_mode(self):
        storm = _storm_js()
        self.assertNotIn("setMode(", storm)

    def test_sfx_respects_existing_toggles(self):
        storm = _storm_js()
        self.assertIn("if (soundMuted || !callSfxOn) return;", storm)
        self.assertIn("ensureAudio()", storm)


class PriorityPacksStillPresentTests(unittest.TestCase):
    def test_gates_still_cold(self):
        self.assertRegex(HTML, r'<body class="gate-locked"')
        self.assertNotRegex(HTML, r"<body[^>]*admin-unlocked")
        self.assertIn("Never start admin-unlocked", HTML)

    def test_closer_charts_table_mark_still_present(self):
        self.assertIn("def official_y_finish", GATES)
        self.assertIn("KXBTCD-26AUG1415-T62999.99", GATES)
        self.assertIn('id="chartEth"', HTML)
        self.assertIn("function drawChartEth()", JS)
        self.assertIn("function drawPacketSpoke", JS)
        self.assertIn('src="/council-mark.png"', HTML)
        self.assertNotIn('src="/zt-logo.jpg"', HTML)


if __name__ == "__main__":
    unittest.main()
