"""Phone punch-list after #41 rebase. Paper. Follower OFF."""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")


def _splash() -> str:
    idx = CSS.find("LOGIN SPLASH — #passwordGate only")
    if idx < 0:
        raise AssertionError("login splash CSS missing")
    return CSS[idx:]


def _init_gate() -> str:
    return JS.split("function initPasswordGate", 1)[1].split("function initLogoCredit", 1)[0]


def _auth() -> str:
    return JS.split("function showAppAfterAuth", 1)[1].split("function playZtIntroThenSummonGate", 1)[0]


def _play() -> str:
    start = JS.find("function playDeskUnlockIntro")
    end = JS.find("window.playDeskUnlockIntro")
    return JS[start:end]


def _summon() -> str:
    return JS.split("function runSummonSequence", 1)[1].split("function runSummonFogFallback", 1)[0]


def _wire_rows() -> list[dict]:
    m = re.search(r"window\.COUNCIL_WIRE\s*=\s*(\[[\s\S]*?\]);", WIRE_JS)
    return json.loads(m.group(1))


class HiddenGateCssTests(unittest.TestCase):
    def test_no_comma_flex_or_bare_flex(self):
        splash = _splash()
        self.assertIn("#passwordGate.password-gate:not(.hidden)", splash)
        self.assertIn("display: flex !important", splash)
        self.assertNotIn("#passwordGate.password-gate,", CSS)
        self.assertNotRegex(CSS, r"#passwordGate\.password-gate\s*\{[^}]*display:\s*flex")
        for _m in re.finditer(r"#passwordGate\.password-gate\s*\{", CSS):
            self.fail("bare #passwordGate.password-gate { must not exist")

    def test_hidden_gate_stays_hidden(self):
        hidden = _splash().split("#passwordGate.password-gate.hidden", 1)[1].split("}", 1)[0]
        self.assertIn("display: none !important", hidden)
        self.assertIn("visibility: hidden !important", hidden)
        self.assertIn("pointer-events: none !important", hidden)


class PactAndSummonTapTests(unittest.TestCase):
    def test_seal_the_pact_first_everywhere(self):
        init = _init_gate()
        self.assertIn("Seal the pact first.", init)
        self.assertNotIn("Check the pact first.", init)
        self.assertNotIn("Check the pact first.", JS)
        self.assertIn("Seal the pact first.", WIRE_JS)
        self.assertNotIn("Check the pact first.", WIRE_JS)

    def test_summon_hit_receives_tap(self):
        init = _init_gate()
        self.assertIn("gateSummonHit", init)
        self.assertIn("tryUnlock()", init)
        self.assertIn("pointer-events: auto", CSS)
        self.assertIn("#passwordSubmit:disabled", CSS)
        self.assertIn("pointer-events: none", CSS.split("#passwordSubmit:disabled", 1)[1][:80])
        self.assertNotIn("if (!syncDeskGateSummon()) return;", init)


class ParkedIntroTests(unittest.TestCase):
    def test_no_intro_after_summon(self):
        auth = _auth()
        play = _play()
        summon = _summon()
        self.assertIn("revealAppAfterDeskUnlock", auth)
        self.assertNotIn("playDeskUnlockIntro()", auth)
        self.assertNotIn("vid.play()", play)
        self.assertNotIn("requestFullscreen", play)
        self.assertNotIn("requestFullscreen", summon)
        self.assertNotIn('classList.add("gate-locked")', auth)
        self.assertNotIn('passwordGate")', auth.split("revealAppAfterDeskUnlock", 1)[1][:400])


class FrontTabGoneTests(unittest.TestCase):
    def test_front_tab_hidden_from_nav(self):
        tabs = HTML.split('id="modeTabs"', 1)[1].split("modeTabsNext", 1)[0]
        self.assertIn('id="tabFront"', tabs)
        self.assertIn("hidden", HTML.split('id="tabFront"', 1)[1][:80])
        self.assertIn('document.body.classList.add("front-tab-off")', JS)
        self.assertIn("#app > header #tabFront", CSS)
        self.assertNotIn('"front"', JS.split("window.__deskModeCycle", 1)[1][:400])
        self.assertIn('data-floor-chair="front"', HTML)
        self.assertIn(">RAIJIN</span>", HTML)
        self.assertIn('id="frontView"', HTML)


class SideTabParkedTests(unittest.TestCase):
    def test_side_tab_hidden_from_nav_and_desk(self):
        tabs = HTML.split('id="modeTabs"', 1)[1].split("modeTabsNext", 1)[0]
        self.assertIn('id="tabSide"', tabs)
        self.assertIn("hidden", HTML.split('id="tabSide"', 1)[1][:80])
        self.assertIn('document.body.classList.add("side-tab-off")', JS)
        self.assertIn("#app > header #tabSide", CSS)
        self.assertIn("body.side-tab-off #sideView", CSS)
        cycle = JS.split("window.__deskModeCycle", 1)[1][:400]
        self.assertNotIn('"side"', cycle)
        self.assertIn('id="sideView"', HTML)
        self.assertIn("SIDE TABLE", HTML)
        self.assertNotIn("/oracle-room.jpg", HTML.split('id="sideView"', 1)[1][:2000])
        self.assertIn('next === "side" && document.body.classList.contains("side-tab-off")', JS)


class FiveLeadersAndClocksTests(unittest.TestCase):
    def test_five_floor_leaders_including_oracle(self):
        keys = JS.split("const FLOOR_CHAIR_KEYS", 1)[1][:240]
        self.assertIn("oracle", keys)
        self.assertIn("bitcoin", keys)
        self.assertIn("ethereum", keys)
        self.assertIn("front", keys)
        self.assertIn("ats", keys)
        self.assertIn('data-floor-chair="oracle"', HTML)
        self.assertIn(">ORACLE</span>", HTML)
        self.assertIn("function isOracleTable", JS)
        self.assertIn("function oracleTableState", JS)
        self.assertNotIn("ORACLE does not place orders", JS)
        self.assertIn("function drawOracleCrtHud", JS)
        self.assertTrue((ROOT / "frontend" / "static" / "oracle-wait.jpg").is_file())
        self.assertIn("/oracle-wait.jpg", JS)
        focus = JS.split("function setFocusTable", 1)[1][:500]
        self.assertIn('focusTable = "oracle"', focus)
        self.assertIn('_focusTable: "oracle"', JS)
        self.assertIn('if (key === "oracle") return "oracle"', JS)
        self.assertIn("/oracle-room.jpg", CSS)
        self.assertIn('id="focusOra"', HTML)
        self.assertIn(">ORA</button>", HTML)
        self.assertNotIn(">GLD</button>", HTML)
        self.assertNotIn("APOLLO", JS.split("ORACLE_SEAT_IDS", 1)[1][:200])
        self.assertIn("SIBYL", JS)
        self.assertIn("VEIL", JS)
        self.assertIn("MARBLE", JS)

    def test_per_leader_timers_exist(self):
        self.assertIn('id="floorLeaderClocks"', HTML)
        for key in ("bitcoin", "ethereum", "front", "ats", "oracle"):
            self.assertIn('data-floor-clock="%s"' % key, HTML)
        self.assertIn("function paintFloorLeaderClocks", JS)
        self.assertIn("function chairWindowClock", JS)
        self.assertIn("body.mode-floor #windowLed", CSS)


class PhoneBackTests(unittest.TestCase):
    def test_phone_back_is_44px(self):
        self.assertIn('id="phoneBackBtn"', HTML)
        self.assertIn("function syncPhoneBackBtn", JS)
        self.assertIn("function wirePhoneBackBtn", JS)
        self.assertIn("setMode(\"floor\")", JS.split("function wirePhoneBackBtn", 1)[1][:400])
        sync = JS.split("function syncPhoneBackBtn", 1)[1][:500]
        self.assertIn("mode !== \"floor\"", sync)
        self.assertNotIn("mode !== \"night\"", sync)
        css = CSS.split(".phone-back-btn", 1)[1][:500]
        self.assertIn("min-height: 44px", css)
        self.assertIn("min-width: 44px", css)


class WireNewestTests(unittest.TestCase):
    def test_notes_newest_first(self):
        rows = _wire_rows()
        self.assertEqual(rows[0]["id"], "2026-08-16-hunter-feeder")
        self.assertIn("2026-08-16-vitalik-rain-still", [r["id"] for r in rows])
        self.assertIn("2026-08-16-hard-mute-wire", [r["id"] for r in rows])
        self.assertIn("2026-08-16-oracle-can-call", [r["id"] for r in rows])
        self.assertIn("2026-08-16-gold-floor-mark", [r["id"] for r in rows])
        self.assertIn("2026-08-16-table-room-plates", [r["id"] for r in rows])
        ats = [r["at"] for r in rows]
        self.assertEqual(ats, sorted(ats, reverse=True))
        blob = WIRE_JS
        self.assertIn("Seal the pact first.", blob)
        self.assertNotIn("Check the pact first.", blob)
        self.assertNotIn("ZT", blob.split("2026-08-16-current-calls", 1)[1].split("2026-08-16-desk-unlock-stay", 1)[0])


if __name__ == "__main__":
    unittest.main()
