"""Phone gate + chrome at 390 and ~430. Paper. Follower OFF."""
from __future__ import annotations

import hashlib
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")


def _password_gate() -> str:
    return HTML.split('id="passwordGate"', 1)[1].split('id="summonGate"', 1)[0]


def _phone_last_word() -> str:
    marker = "PHONE 390/430 — last word"
    idx = CSS.find(marker)
    if idx < 0:
        raise AssertionError("phone last-word CSS block missing")
    return CSS[idx:]


def _splash_css() -> str:
    marker = "LOGIN SPLASH — #passwordGate only"
    idx = CSS.find(marker)
    if idx < 0:
        raise AssertionError("login splash CSS block missing")
    return CSS[idx:]


def _width_decls(block: str) -> list[str]:
    return re.findall(r"(?:min-|max-)?width\s*:\s*[^;]+", block, flags=re.I)


class PhoneWidthLockTests(unittest.TestCase):
    def test_viewport_is_device_width_not_375(self):
        meta = re.search(r'<meta name="viewport"[^>]+>', HTML)
        self.assertIsNotNone(meta)
        content = meta.group(0)
        self.assertIn("width=device-width", content)
        self.assertIn("viewport-fit=cover", content)
        self.assertIn("interactive-widget=resizes-content", content)
        self.assertNotIn("width=375", content)
        self.assertNotIn("width=360", content)
        self.assertNotIn("width=390", content)

    def test_html_body_app_gate_use_percent_or_dvw(self):
        last = _phone_last_word()
        self.assertIn("width: 100%", last)
        self.assertIn("max-width: 100dvw", last)
        self.assertIn("min-width: 100%", last)
        chunk = last
        for banned in ("375px", "360px", "390px"):
            self.assertNotIn(banned, chunk)
        for decl in _width_decls(chunk.split("body.phone-floor", 1)[0]):
            self.assertNotRegex(decl, r"\b(360|375|390)px\b")

    def test_no_100vw_max_on_html_body_phone(self):
        phone_blocks = re.findall(
            r"@media \(max-width: 480px\) \{.*?^\}",
            CSS,
            flags=re.S | re.M,
        )
        self.assertGreater(len(phone_blocks), 2)
        for block in phone_blocks:
            head = block[:800]
            if "html, body" in head or "html, body, #app" in head:
                self.assertNotIn("max-width: 100vw", head)


class PhoneGateStickyTests(unittest.TestCase):
    def test_agree_and_summon_are_in_sticky_bar(self):
        gate = _password_gate()
        self.assertIn('id="gateStickyActions"', gate)
        self.assertIn('class="gate-sticky-actions"', gate)
        sticky = gate.split('id="gateStickyActions"', 1)[1]
        self.assertIn('id="gateAgree"', sticky)
        self.assertIn('id="passwordSubmit"', sticky)
        self.assertIn("SUMMON THE COUNCIL", sticky)
        self.assertIn('id="passwordInput"', gate)
        self.assertLess(gate.find('id="passwordInput"'), gate.find('id="gateStickyActions"'))

    def test_sticky_css_and_keyboard_viewport(self):
        splash = _splash_css()
        self.assertIn("position: sticky", splash)
        self.assertIn("bottom: 0", splash)
        self.assertIn("100svh", splash)
        self.assertIn("100dvh", splash)
        self.assertIn("env(safe-area-inset-bottom", splash)
        self.assertIn("padding-top: 36vh", splash)

    def test_agree_row_is_44px_tap_target(self):
        splash = _splash_css()
        agree = splash.split("#passwordGate .gate-agree", 1)[1][:500]
        self.assertIn("min-height: 44px", agree)
        self.assertIn("min-width: 44px", agree)
        self.assertIn('for="gateAgree"', _password_gate())

    def test_pact_type_is_16px_on_phone_only(self):
        splash = _splash_css()
        phone = splash.split("@media (max-width: 480px)", 1)[1]
        li = phone.split("#passwordGate .gate-oath li", 1)[1][:200]
        self.assertIn("font-size: 16px", li)
        desktop_li = CSS.split(".gate-oath li {", 1)[1][:250]
        self.assertIn("font-size: 11px", desktop_li)
        self.assertNotIn("font-size: 16px", desktop_li)


class PhoneTabBarTests(unittest.TestCase):
    def test_scroll_shell_and_arrows_exist(self):
        self.assertIn('id="modeTabsShell"', HTML)
        self.assertIn('id="modeTabsPrev"', HTML)
        self.assertIn('id="modeTabsNext"', HTML)
        self.assertIn('id="modeTabs"', HTML)
        self.assertIn("function initModeTabsScroll", JS)
        self.assertIn("scrollBy", JS)
        last = _phone_last_word()
        self.assertIn("mode-tabs-arrow", last)
        self.assertIn("mask-image", last)
        self.assertIn("overflow-x: auto", last)
        self.assertNotIn('id="tabMore"', HTML)

    def test_first_class_tabs_stay_and_no_new_tabs(self):
        tabs = HTML.split('id="modeTabs"', 1)[1].split("modeTabsNext", 1)[0]
        for needle in ('id="tabFloor"', 'id="tabScreensaver"', 'id="tabSeats"', 'id="tabPaper"'):
            self.assertIn(needle, tabs)
        self.assertIn('id="tabNight"', tabs)
        self.assertIn('id="soundToggle"', HTML)
        self.assertIn('id="seatSpinBtn"', HTML)
        last = _phone_last_word()
        self.assertIn("body.phone-floor #tabSeats", last)
        self.assertIn("body.phone-floor #tabPaper", last)


class PhoneFloorChromeTests(unittest.TestCase):
    def test_one_handed_safe_area_no_desktop_hud(self):
        last = _phone_last_word()
        self.assertIn("--floor-table-rail: 0px", last)
        self.assertIn("env(safe-area-inset-top", last)
        self.assertIn("env(safe-area-inset-bottom", last)
        self.assertIn("body.phone-floor .color-tally", last)
        self.assertIn("body.phone-floor #huddleBanner", last)
        self.assertIn("pointer-events: auto", last)
        self.assertIn("body.phone-floor #roundtable", last)
        self.assertIn("function floorSeatDirLocked(", JS)
        self.assertIn("onFloor ? [] : roster", JS)
        self.assertIn("Floor is leaders only", JS)

    def test_leader_click_still_wired(self):
        self.assertIn("function wireFloorChairClicks", JS)
        self.assertIn("playLeaderClickVideo()", JS)
        self.assertIn("chairHitAt", JS)


class PhoneWireAndFreezeTests(unittest.TestCase):
    def test_wire_note_newest_first(self):
        self.assertIn("2026-08-15-phone-gate-nav", WIRE_JS)
        self.assertIn("100% / 100dvw", WIRE_JS)
        self.assertIn("Paper. Follower OFF.", WIRE_JS)
        self.assertNotIn("ZT", WIRE_JS.split("2026-08-15-phone-gate-nav", 1)[1].split("2026-08-15-login-splash", 1)[0])
        self.assertLess(
            WIRE_JS.find("2026-08-15-phone-gate-nav"),
            WIRE_JS.find("2026-08-15-login-splash"),
        )

    def test_no_secrets_and_no_follower_live(self):
        blob = HTML + CSS + JS + WIRE_JS
        for banned in ("STRIPE", "sk_live", "FOLLOWER_PASSWORD", "DESK_CODE"):
            self.assertNotIn(banned, blob)
        self.assertIn("paper default · live off", JS)
        self.assertIn("Never auto-bet", JS)
        for rel in (
            "backend/services/follower_gate.py",
            "backend/services/follower_route.py",
            "frontend/protected/follower_gate.js",
            "frontend/protected/follower_gate.html",
            "frontend/protected/follower_bundle.js",
        ):
            raw = (ROOT / rel).read_bytes()
            self.assertGreater(len(raw), 40, rel)
            hashlib.sha256(raw).hexdigest()

    def test_no_zt_in_gate_copy(self):
        gate = _password_gate()
        title = HTML.split("<title>", 1)[1].split("</title>", 1)[0]
        self.assertEqual(title, "Satoshi’s Council")
        self.assertNotIn("ZT", title)
        self.assertNotIn("ZT", gate)
        self.assertIn("SATOSHI’S COUNCIL", gate)


if __name__ == "__main__":
    unittest.main()
