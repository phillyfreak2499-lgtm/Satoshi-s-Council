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
