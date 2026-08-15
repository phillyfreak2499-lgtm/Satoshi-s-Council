"""After SUMMON the login gate stays hidden. Splash CSS from #36 was the live loop."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")


def _splash_css() -> str:
    marker = "LOGIN SPLASH — #passwordGate only"
    idx = CSS.find(marker)
    if idx < 0:
        raise AssertionError("login splash CSS block missing")
    return CSS[idx:]


def _play_fn() -> str:
    start = JS.find("function playDeskUnlockIntro")
    end = JS.find("window.playDeskUnlockIntro")
    assert start > 0 and end > start
    return JS[start:end]


def _auth_fn() -> str:
    return JS.split("function showAppAfterAuth", 1)[1].split("function playZtIntroThenSummonGate", 1)[0]


def _init_gate() -> str:
    return JS.split("function initPasswordGate", 1)[1].split("function initLogoCredit", 1)[0]


class SplashHiddenSelectorTests(unittest.TestCase):
    def test_flex_only_when_gate_is_visible(self):
        splash = _splash_css()
        self.assertIn("#passwordGate.password-gate:not(.hidden)", splash)
        self.assertIn("display: flex !important", splash)
        self.assertNotIn("#passwordGate.password-gate,", splash)
        self.assertNotRegex(
            CSS,
            r"#passwordGate\.password-gate\s*\{[^}]*display:\s*flex",
        )
        for m in re.finditer(r"#passwordGate\.password-gate\s*\{", CSS):
            self.fail("bare #passwordGate.password-gate { must not exist")

    def test_hidden_gate_is_forced_off(self):
        splash = _splash_css()
        hidden = splash.split("#passwordGate.password-gate.hidden", 1)[1].split("}", 1)[0]
        self.assertIn("display: none !important", hidden)
        self.assertIn("visibility: hidden !important", hidden)
        self.assertIn("pointer-events: none !important", hidden)

    def test_cold_load_visible_rule_stays_not_hidden(self):
        cold = CSS.split("COLD-LOAD GATES", 1)[1].split("Successful desk unlock", 1)[0]
        self.assertIn("#passwordGate.password-gate:not(.hidden)", cold)
        self.assertIn("display: flex !important", cold)
        self.assertNotIn("#passwordGate.password-gate,", cold)


class ParkedIntroTests(unittest.TestCase):
    def test_live_unlock_does_not_play_clips(self):
        play = _play_fn()
        auth = _auth_fn()
        self.assertIn("Parked on the live path", play)
        self.assertIn("return;", play)
        self.assertNotIn("vid.play()", play)
        self.assertNotIn("getElementById(\"deskIntroVideo\")", play)
        self.assertNotIn("getElementById(\"summonVideo\")", play)
        self.assertNotIn("playDeskUnlockIntro()", auth)
        self.assertIn("revealAppAfterDeskUnlock", auth)
        self.assertEqual(JS.count("playDeskUnlockIntro();"), 0)

    def test_clips_stay_in_markup_but_not_after_summon(self):
        self.assertIn('id="deskIntroVideo"', HTML)
        self.assertIn("/zt-intro.mp4", HTML)
        self.assertIn('id="summonVideo"', HTML)
        self.assertIn("/summon-council.mp4", HTML)
        auth = _auth_fn()
        self.assertNotIn("zt-intro", auth)
        self.assertNotIn("summon-council", auth)


class GateOnceTests(unittest.TestCase):
    def test_init_password_gate_wired_once(self):
        init = _init_gate()
        self.assertIn("initPasswordGate.__wired", init)
        self.assertLess(init.find("initPasswordGate.__wired"), init.find("localStorage.removeItem(passKey)"))
        self.assertIn("leftover unlocked session is not the public default", init)


class UnlockStayWireTests(unittest.TestCase):
    def test_wire_newest_first_no_zt(self):
        self.assertLess(
            WIRE_JS.find("2026-08-16-desk-unlock-stay"),
            WIRE_JS.find("2026-08-15-hit-slate-reset"),
        )
        note = WIRE_JS.split("2026-08-16-desk-unlock-stay", 1)[1].split("2026-08-15-hit-slate-reset", 1)[0]
        self.assertIn("After SUMMON the gate stays hidden", note)
        self.assertIn("intro parked", note)
        self.assertIn("desk shows", note)
        self.assertIn("Paper", note)
        self.assertIn("Follower OFF", note)
        self.assertNotIn("ZT", note)


class ProductNameTests(unittest.TestCase):
    def test_gate_copy_is_satoshi_council(self):
        gate = HTML.split('id="passwordGate"', 1)[1].split('id="summonGate"', 1)[0]
        self.assertIn("SATOSHI’S COUNCIL", gate)
        self.assertNotIn("ZT", gate)
        self.assertIn("<title>Satoshi’s Council</title>", HTML)


if __name__ == "__main__":
    unittest.main()
