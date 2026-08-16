"""Current Calls tab + punchy Chair live-call copy. Paper. Follower OFF."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

from backend.services.desk_pack import why_line

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")


class HiddenGateStillCleanTests(unittest.TestCase):
    def test_no_comma_flex(self):
        self.assertNotIn("#passwordGate.password-gate,", CSS)
        self.assertIn("#passwordGate.password-gate:not(.hidden)", CSS)
        hidden = CSS.split("#passwordGate.password-gate.hidden", 1)[1].split("}", 1)[0]
        self.assertIn("display: none !important", hidden)
        for _m in re.finditer(r"#passwordGate\.password-gate\s*\{", CSS):
            self.fail("bare #passwordGate.password-gate { must not exist")


class CurrentCallsTabTests(unittest.TestCase):
    def test_tab_and_board(self):
        tabs = HTML.split('id="modeTabs"', 1)[1].split("modeTabsNext", 1)[0]
        self.assertIn('id="tabCalls"', tabs)
        self.assertIn('data-mode="calls"', tabs)
        self.assertIn(">Calls</button>", tabs)
        self.assertLess(tabs.find('id="tabPaper"'), tabs.find('id="tabCalls"'))
        self.assertIn('id="callsView"', HTML)
        self.assertIn("<h2>CURRENT CALLS</h2>", HTML)
        self.assertIn("Satoshi’s Council", HTML.split('id="callsView"', 1)[1][:400])
        self.assertNotIn("ZT", HTML.split('id="callsView"', 1)[1][:800])
        board = HTML.split('id="callsBoard"', 1)[1].split("</ol>", 1)[0]
        for key in ('data-call="bitcoin"', 'data-call="ethereum"', 'data-call="front"', 'data-call="oracle"'):
            self.assertIn(key, board)
        self.assertNotIn('data-call="ats"', board)

    def test_mode_and_phone_back(self):
        self.assertIn('mode === "calls"', JS)
        self.assertIn("function paintCurrentCalls(", JS)
        self.assertIn("function liveCallCard(", JS)
        self.assertIn("function wireCallsBoard(", JS)
        self.assertIn("wireCallsBoard()", JS)
        cycle = JS.split("window.__deskModeCycle = function", 1)[1][:400]
        self.assertIn('"calls"', cycle)
        self.assertIn("body.mode-calls #tabCalls", CSS)
        self.assertIn("body.phone-floor #tabCalls", CSS)
        self.assertIn("body.night-mode #tabCalls", CSS)
        self.assertIn(".calls-board", CSS)
        self.assertIn(".calls-row", CSS)
        sync = JS.split("function syncPhoneBackBtn", 1)[1][:400]
        self.assertIn("mode !== \"floor\"", sync)
        self.assertIn("min-height: 44px", CSS.split(".phone-back-btn", 1)[1][:400])


class PunchyCallCopyTests(unittest.TestCase):
    def test_js_is_not_spreadsheet(self):
        fn = JS.split("function liveCallCard", 1)[1].split("function chairWhyLineText", 1)[0]
        self.assertIn("LOCK ", fn)
        self.assertIn("WAIT", fn)
        self.assertIn("WATCH", fn)
        self.assertNotIn("P(finish)", fn)
        self.assertNotIn("book has size", fn)
        self.assertNotIn("regime ", fn)
        self.assertNotIn("NEW ENTRY", JS.split("const live = liveCallCard", 1)[1][:500])
        why = JS.split("function chairWhyLineText", 1)[1][:500]
        self.assertIn("liveCallCard", why)
        self.assertNotIn("debug dump", why.lower())

    def test_why_line_lock_and_wait(self):
        self.assertEqual(
            why_line(
                decision={"direction": "UP"},
                market={"floor_strike": 63100, "seconds_left": 400},
                locked_call={"locked": True, "direction": "UP"},
            ),
            "LOCK UP · $63,100 · 06:40",
        )
        self.assertEqual(
            why_line(decision={"direction": "WAIT"}, market={"floor_strike": 2500}),
            "WAIT · $2,500 · 1H",
        )

    def test_chair_table_plate_is_punchy(self):
        bots = JS.split("function drawTableWithBots", 1)[1].split("function drawMiniTable", 1)[0]
        self.assertIn("paintLiveCallPlate(", bots)
        self.assertIn("liveCallCard(", bots)
        self.assertNotIn("LOCKED ", bots)
        self.assertNotIn("% · waiting", bots)
        self.assertNotIn("Q:", bots)
        self.assertNotIn("FOLLOW THIS", bots)
        mini = JS.split("function drawMiniTable", 1)[1].split("function rememberChairHit", 1)[0]
        self.assertIn("paintLiveCallPlate(", mini)
        self.assertNotIn("FOLLOW THIS", mini)
        self.assertNotIn("one call / best odds", mini)
        front = JS.split("function drawFrontTable(", 1)[1].split("function seedFrontWx(", 1)[0]
        self.assertIn("paintLiveCallPlate(", front)
        self.assertNotIn("LOCKED ", front)
        meta = HTML.split('id="signalChairMeta"', 1)[1][:120]
        self.assertNotIn("P(finish)", meta)
        self.assertNotIn("EV —", meta)
        plate = JS.split("LIVE CALL plate", 1)[1][:1600]
        self.assertIn("liveFocus.line", plate)
        self.assertNotIn("FOLLOW", plate)
        self.assertNotIn("best odds", plate)

    def test_wire_note(self):
        self.assertIn("2026-08-16-coinglass-plan-wall", WIRE_JS)
        self.assertIn("2026-08-16-coinglass-hud-only", WIRE_JS)
        self.assertIn("2026-08-16-chair-table-call", WIRE_JS)
        self.assertIn("2026-08-16-current-calls", WIRE_JS)
        self.assertIn("Current Calls", WIRE_JS)
        self.assertLess(WIRE_JS.find("2026-08-16-coinglass-plan-wall"), WIRE_JS.find("2026-08-16-coinglass-hud-only"))
        self.assertLess(WIRE_JS.find("2026-08-16-chair-table-call"), WIRE_JS.find("2026-08-16-current-calls"))
        self.assertIn("Follower OFF", WIRE_JS.split("2026-08-16-coinglass-plan-wall", 1)[1][:500])
        self.assertNotIn("ZT", WIRE_JS.split("2026-08-16-coinglass-plan-wall", 1)[1].split("2026-08-16-hour-ladder", 1)[0])


if __name__ == "__main__":
    unittest.main()
