"""Seats stay painted, glass seats stay live on Binance fallback, desk unsticks."""
from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SW = (ROOT / "frontend" / "static" / "sw.js").read_text(encoding="utf-8")
ASSEMBLER = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
COINGLASS = (ROOT / "backend" / "data" / "coinglass.py").read_text(encoding="utf-8")
PIPELINE = (ROOT / "backend" / "data" / "pipeline.py").read_text(encoding="utf-8")
DUAL = (ROOT / "backend" / "services" / "dual.py").read_text(encoding="utf-8")
COUNCIL = (ROOT / "backend" / "services" / "council.py").read_text(encoding="utf-8")
ROUNDTABLE = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
RENDER = (ROOT / "render.yaml").read_text(encoding="utf-8")
PORTRAITS = ROOT / "frontend" / "static" / "portraits"


def _desk_html() -> str:
    return (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")


class GlassFallbackTests(unittest.TestCase):
    def test_binance_perp_is_the_fallback(self) -> None:
        self.assertIn("fapi.binance.com", PIPELINE)
        self.assertIn("data-api.binance.vision", PIPELINE)
        self.assertIn("www.okx.com", PIPELINE)

    def test_spot_feed_ok_can_be_false(self) -> None:
        from backend.data.spot_health import spot_feed_ok
        self.assertFalse(spot_feed_ok())
        self.assertFalse(spot_feed_ok({}, {}))
        self.assertTrue(spot_feed_ok({"binance": True}, {}))


class HydrateSeatsTests(unittest.TestCase):
    def test_shell_helpers_exist(self) -> None:
        self.assertIn("def ensure_seat_shell", COUNCIL)
        self.assertIn("ANALYZE_TIMEOUT_S", DUAL)


class SwUnstickTests(unittest.TestCase):
    def test_sw_does_not_precache_root(self) -> None:
        self.assertNotIn('"/",', SW.split("const PRECACHE")[1].split("];")[0])
        self.assertIn("isDocument", SW)
        self.assertIn("20260831f", SW)

    def test_homepage_is_the_desk(self) -> None:
        self.assertIn("passwordSubmit", ASSEMBLER)
        self.assertIn("id=\"roundtable\"", ASSEMBLER)
        self.assertNotIn("desk-0.b64", ASSEMBLER)


class DeskHtmlTests(unittest.TestCase):
    def test_summon_not_disabled_and_hit_rate_admin_only(self) -> None:
        html = _desk_html()
        self.assertIn('id="passwordSubmit"', html)
        open_tag = html.split('id="passwordSubmit"', 1)[1].split(">", 1)[0]
        self.assertNotIn(" disabled", open_tag)
        self.assertIn('aria-disabled="false"', open_tag)
        self.assertIn('id="accuracyBadge"', html)
        self.assertIn('id="hitRateCard"', html)
        self.assertNotIn('id="passwordInput"', html)
        self.assertIn("oath: true", (ROOT / "frontend" / "static" / "seat.js").read_text(encoding="utf-8"))

    def test_crowd_and_flow_portraits_exist(self) -> None:
        self.assertTrue((PORTRAITS / "crowd.webp").is_file())
        self.assertTrue((PORTRAITS / "flow.webp").is_file())


class RoundtableParseTests(unittest.TestCase):
    def test_is_phone_desk_is_a_real_function(self) -> None:
        self.assertIn("function isPhoneDesk()", ROUNDTABLE)

    def test_node_check_roundtable(self) -> None:
        node = shutil.which("node") or shutil.which("nodejs")
        if not node:
            self.skipTest("node not on PATH")
        for name in ("roundtable.js", "desk-fx.js"):
            r = subprocess.run(
                [node, "--check", str(ROOT / "frontend" / "static" / name)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(r.returncode, 0, name + " " + (r.stderr or r.stdout))

    def test_admin_password_is_not_in_the_browser(self) -> None:
        self.assertNotIn("5152622439", ROUNDTABLE)
        self.assertNotIn("?admin=", ROUNDTABLE)
        html = _desk_html()
        self.assertNotIn("5152622439", html)


if __name__ == "__main__":
    unittest.main()
