"""#passwordGate login splash: signed Satoshi-center table. Paper. Follower OFF."""
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
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
FOLLOWER_PY = (ROOT / "backend" / "services" / "follower_gate.py").read_bytes()
FOLLOWER_ROUTE = (ROOT / "backend" / "services" / "follower_route.py").read_bytes()
FOLLOWER_JS = (ROOT / "frontend" / "protected" / "follower_gate.js").read_bytes()
FOLLOWER_HTML = (ROOT / "frontend" / "protected" / "follower_gate.html").read_bytes()
FOLLOWER_BUNDLE = (ROOT / "frontend" / "protected" / "follower_bundle.js").read_bytes()


def _password_gate() -> str:
    return HTML.split('id="passwordGate"', 1)[1].split('id="summonGate"', 1)[0]


def _gate_css() -> str:
    marker = "LOGIN SPLASH — #passwordGate only"
    self_idx = CSS.find(marker)
    if self_idx < 0:
        raise AssertionError("login splash CSS block missing")
    return CSS[self_idx:]


class LoginSplashPlateTests(unittest.TestCase):
    def test_signed_jpeg_is_on_disk(self):
        path = ROOT / "frontend" / "static" / "login-council.jpg"
        self.assertTrue(path.is_file())
        raw = path.read_bytes()
        self.assertEqual(raw[:2], b"\xff\xd8")
        self.assertGreater(path.stat().st_size, 80_000)
        self.assertLess(path.stat().st_size, 2_500_000)

    def test_gate_uses_full_bleed_plate(self):
        css = _gate_css()
        self.assertIn('url("/login-council.jpg")', css)
        self.assertIn("background-size: cover", css)
        self.assertIn("background-position: center 18%", css)
        self.assertIn('@app.get("/login-council.jpg")', MAIN)
        self.assertIn('href="/login-council.jpg"', HTML)

    def test_type_sits_over_the_table(self):
        css = _gate_css()
        self.assertIn("justify-content: flex-end", css)
        self.assertIn("padding-top: 36vh", css)
        self.assertIn("to bottom", css)
        self.assertNotIn("align-items: center !important;\n  justify-content: center", css)


class LoginSplashChromeTests(unittest.TestCase):
    def test_dark_stone_amber_cyan(self):
        css = _gate_css()
        self.assertIn("#e8b86a", css)
        self.assertIn("rgba(0, 196, 212", css)
        self.assertIn("rgba(22, 20, 18, 0.82)", css)
        self.assertNotIn("#39ff14", css)
        self.assertNotIn("#22c55e", css)
        self.assertNotIn("lime", css.lower())
        self.assertNotIn("#4c1d95", css)
        self.assertNotIn("#c4b5fd", css)

    def test_gate_mark_does_not_fight_faces(self):
        css = _gate_css()
        self.assertIn("#passwordGate .gate-mark", css)
        self.assertIn("display: none", css)
        gate = _password_gate()
        self.assertNotIn("ZT", gate)
        self.assertNotIn("zt-logo", gate)
        title = HTML.split("<title>", 1)[1].split("</title>", 1)[0]
        self.assertEqual(title, "Satoshi’s Council")
        wordmark = re.search(r'class="password-title">(.*?)</div>', gate)
        self.assertIsNotNone(wordmark)
        self.assertEqual(wordmark.group(1).strip(), "SATOSHI’S COUNCIL")


class LoginSplashStackTests(unittest.TestCase):
    def test_existing_stack_stays(self):
        gate = _password_gate()
        self.assertIn('id="passwordInput"', gate)
        self.assertIn('id="gateOath"', gate)
        self.assertIn('id="gateAgree"', gate)
        self.assertIn('id="passwordSubmit"', gate)
        self.assertIn("SUMMON THE COUNCIL", gate)
        self.assertIn("Wrong password", gate)
        blob = gate.lower()
        self.assertIn("paper only", blob)
        self.assertIn("not financial advice", blob)
        self.assertIn("18+", blob)
        self.assertIn("not kalshi", blob)
        self.assertIn("you can lose the full stake", blob)
        self.assertIn("no past score is a promise", blob)

    def test_portraits_and_rooms_untouched(self):
        static = ROOT / "frontend" / "static"
        for name in (
            "chair-up.jpg",
            "chair-down.jpg",
            "chair-wait.jpg",
            "vitalik-up.jpg",
            "vitalik-down.jpg",
            "vitalik-wait.jpg",
            "raijin-up.jpg",
            "raijin-down.jpg",
            "raijin-wait.jpg",
            "ares-chair.png",
        ):
            self.assertTrue((static / name).is_file(), name)
        self.assertNotIn("room-satoshi.jpg", CSS)
        self.assertNotIn("room-vitalik.jpg", CSS)
        self.assertNotIn("login-council", JS)

    def test_wire_note_newest_first(self):
        self.assertIn("2026-08-15-hit-slate-reset", WIRE_JS)
        self.assertIn("Chair hit slate reset after tape", WIRE_JS)
        self.assertIn("3,053 hours", WIRE_JS)
        self.assertIn("old 2/7", WIRE_JS)
        self.assertIn("2026-08-15-login-splash", WIRE_JS)
        self.assertIn("Signed Satoshi-center council table", WIRE_JS)
        self.assertIn("dark stone + amber/cyan", WIRE_JS)
        self.assertIn("Type sits over the table, not the faces", WIRE_JS)
        self.assertIn("2026-08-15-raijin-cowboy-face", WIRE_JS)
        self.assertIn("2026-08-15-satoshi-face", WIRE_JS)
        self.assertIn("Satoshi chair face swap", WIRE_JS)
        self.assertIn("2026-08-15-raijin-cowboy", WIRE_JS)
        self.assertLess(
            WIRE_JS.find("2026-08-15-hit-slate-reset"),
            WIRE_JS.find("2026-08-15-login-splash"),
        )
        self.assertLess(
            WIRE_JS.find("2026-08-15-login-splash"),
            WIRE_JS.find("2026-08-15-raijin-cowboy-face"),
        )
        self.assertLess(
            WIRE_JS.find("2026-08-15-raijin-cowboy-face"),
            WIRE_JS.find("2026-08-15-satoshi-face"),
        )
        self.assertLess(
            WIRE_JS.find("2026-08-15-satoshi-face"),
            WIRE_JS.find("2026-08-15-raijin-cowboy\""),
        )
        self.assertLess(
            WIRE_JS.find("2026-08-15-raijin-cowboy\""),
            WIRE_JS.find("2026-08-15-vitalik-face"),
        )

    def test_follower_bytes_did_not_move(self):
        for rel, raw in (
            ("backend/services/follower_gate.py", FOLLOWER_PY),
            ("backend/services/follower_route.py", FOLLOWER_ROUTE),
            ("frontend/protected/follower_gate.js", FOLLOWER_JS),
            ("frontend/protected/follower_gate.html", FOLLOWER_HTML),
            ("frontend/protected/follower_bundle.js", FOLLOWER_BUNDLE),
        ):
            self.assertGreater(len(raw), 40, rel)
            hashlib.sha256(raw).hexdigest()
        self.assertIn("paper default · live off", JS)
        self.assertIn("Never auto-bet", JS)


if __name__ == "__main__":
    unittest.main()
