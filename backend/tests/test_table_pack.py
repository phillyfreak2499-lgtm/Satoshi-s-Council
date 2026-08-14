"""Table HUD: pulsing Chair beams, bigger portraits, right-side signal feed."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")


class TableBeamTests(unittest.TestCase):
    def test_packets_travel_toward_chair(self):
        self.assertIn("function drawPacketSpoke", JS)
        self.assertIn("function markSeatTick", JS)
        self.assertIn("lineDashOffset", JS)
        self.assertIn("const fast = !!(agree || fresh)", JS)
        self.assertIn("Visual pulse stays on when Bell is muted", JS)
        self.assertNotIn("if (reduceMotion || soundMuted) return;", JS)

    def test_lean_colors_used_on_spokes(self):
        self.assertIn("strongColor(agent.direction)", JS)
        self.assertIn('adir === "UP"', JS)
        self.assertIn('adir === "DOWN"', JS)


class TablePortraitTests(unittest.TestCase):
    def test_portraits_fill_the_seat(self):
        self.assertIn("const pr = radius * 0.80", JS)
        self.assertIn("mode === \"floor\" ? 0.22 : 0.28", JS)
        self.assertIn("contain + (cover - contain) * 0.82", JS)
        self.assertIn('ctx.imageSmoothingQuality = "high"', JS)
        self.assertIn("const plateY = cy + radius + 14", JS)


class TableFeedTests(unittest.TestCase):
    def test_feed_is_packets_not_reasoning_only(self):
        self.assertIn('id="signalFeed"', HTML)
        self.assertIn('id="signalChair"', HTML)
        self.assertIn('id="signalChairLast"', HTML)
        feed = HTML.split('id="debatePanel"', 1)[1]
        chair = feed.find('id="signalChair"')
        ol = feed.find('id="signalFeed"')
        self.assertGreater(chair, ol)
        self.assertIn("No specialist packets yet", JS)
        self.assertNotIn(".filter((s) => s.shout)", JS)
        self.assertIn("sf-in", JS)
        self.assertIn("P(finish)", JS)
        self.assertIn("last lock", JS)

    def test_table_right_column_shows_feed(self):
        self.assertIn('grid-template-areas: "lifetime table debate"', CSS)
        self.assertIn("body.mode-art #debatePanel.signal-feed", CSS)
        self.assertIn("sfPacketIn", CSS)


class TableRightHudTests(unittest.TestCase):
    def test_right_column_has_tape_why_fight_storm(self):
        right = HTML.split('id="debatePanel"', 1)[1].split('id="hierarchyPanel"', 1)[0]
        left = HTML.split('id="lifetimePanel"', 1)[1].split('id="tableStage"', 1)[0]
        self.assertIn('id="lockTapeList"', right)
        self.assertIn('id="whyLockLine"', right)
        self.assertIn('id="dualFightStrip"', right)
        self.assertIn('id="seatStormTableBtn"', right)
        self.assertNotIn('id="lockTapeList"', left)
        self.assertNotIn('id="whyLockLine"', left)
        self.assertNotIn('id="dualFightStrip"', left)
        self.assertNotIn('id="seatStormTableBtn"', left)
        self.assertIn("START SEAT STORM", HTML)
        self.assertIn("function paintTableHud", JS)
        self.assertIn("function whyThisLockLine", JS)
        self.assertIn("No Chair lock this hour", JS)
        self.assertIn("No Chair lock this hour", HTML)
        self.assertNotIn("LIFETIME LOG EMPTY", JS)
        self.assertIn('class="lifetime-log-block idle"', HTML)
        self.assertIn('logBlock.classList.add("idle")', JS)
        self.assertIn("Never auto-starts", JS)
        self.assertIn("#debatePanel .lock-tape-card", CSS)

    def test_one_h_still_docks_in_left_column(self):
        panel = HTML.find('id="lifetimePanel"')
        led = HTML.find('id="windowLed"')
        debate = HTML.find('id="debatePanel"')
        self.assertGreater(led, panel)
        self.assertLess(led, debate)
        self.assertIn("body.mode-art #lifetimePanel #windowLed", CSS)
        self.assertIn("html body.mode-art #lifetimePanel #windowLed.led-float.led-window", CSS)
        self.assertNotIn("#lifetimePanel .lock-tape-card", CSS)
        self.assertIn("function dockWindowLed", JS)


class PriorityPacksStillPresentTests(unittest.TestCase):
    def test_gates_still_cold(self):
        self.assertRegex(HTML, r'<body class="gate-locked"')
        self.assertNotRegex(HTML, r"<body[^>]*admin-unlocked")
        self.assertIn("Never start admin-unlocked", HTML)

    def test_closer_and_charts_still_present(self):
        self.assertIn("def official_y_finish", GATES)
        self.assertIn("KXBTCD-26AUG1415-T62999.99", GATES)
        self.assertIn('id="chartEth"', HTML)
        self.assertIn("function drawChartEth()", JS)
        self.assertIn('p => p.down, "#ff2d55"', JS)


if __name__ == "__main__":
    unittest.main()
