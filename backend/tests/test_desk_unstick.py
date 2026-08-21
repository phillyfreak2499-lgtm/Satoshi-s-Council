"""Seats stay painted, glass seats stay live on Binance fallback, desk unsticks."""
from __future__ import annotations

import base64
import gzip
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
    parts = [(ROOT / "frontend" / "static" / f"desk-{i}.b64").read_text() for i in range(12)]
    raw = gzip.decompress(base64.b64decode("".join(parts).encode("ascii")))
    return raw.decode("utf-8")


class GlassFallbackTests(unittest.TestCase):
    def test_binance_perp_is_the_fallback(self) -> None:
        self.assertIn("fapi.binance.com", PIPELINE)
        self.assertIn("data-api.binance.vision", PIPELINE)
        self.assertIn("www.okx.com", PIPELINE)
        self.assertIn("derivs_ok", PIPELINE)
        self.assertIn("lastFundingRate", PIPELINE)
        self.assertIn("openInterest", PIPELINE)
        self.assertIn("okx_perp", PIPELINE)

    def test_spot_feed_ok_can_be_false(self) -> None:
        from backend.data.spot_health import spot_feed_ok
        self.assertFalse(spot_feed_ok())
        self.assertFalse(spot_feed_ok({}, {}))
        self.assertFalse(spot_feed_ok({"binance": False, "coinbase": False}, {"current_price": 72583, "last_good": True}))
        self.assertTrue(spot_feed_ok({"binance": True}, {}))
        self.assertTrue(spot_feed_ok({"coinbase": True}, {}))
        src = (ROOT / "backend" / "data" / "spot_health.py").read_text(encoding="utf-8")
        self.assertNotIn("return True", src.split("def spot_feed_ok", 1)[1].split("if h.get", 1)[0])

    def test_pick_spot_and_okx_row(self) -> None:
        from backend.data.pipeline import _okx_row, pick_spot
        price, src = pick_spot({"price": "77756.13"}, None, None)
        self.assertAlmostEqual(price, 77756.13)
        self.assertEqual(src, "binance_vision")
        price, src = pick_spot(None, None, {"data": {"amount": "77698.59"}})
        self.assertEqual(src, "coinbase")
        row = _okx_row({"code": "0", "data": [{"fundingRate": "0.0001", "oiCcy": "30483"}]})
        self.assertEqual(row.get("fundingRate"), "0.0001")
        self.assertEqual(_okx_row({"code": "451"}), {})

    def test_glass_wait_only_when_no_derivs(self) -> None:
        self.assertIn("def glass_seats_must_wait", COINGLASS)
        self.assertIn('md.get("funding_rate")', COINGLASS)
        self.assertIn('health.get("derivs_ok")', COINGLASS)

    def test_merge_fills_funding_from_last_good(self) -> None:
        self.assertIn("def _merge_last_good", PIPELINE)
        self.assertIn('snap["last_good"] = True', PIPELINE)
        self.assertIn("funding_rate", PIPELINE)
        self.assertIn("open_interest", PIPELINE)


class HydrateSeatsTests(unittest.TestCase):
    def test_shell_helpers_exist(self) -> None:
        self.assertIn("def ensure_seat_shell", COUNCIL)
        self.assertIn("def _wait_agent_shell", COUNCIL)
        self.assertIn("ANALYZE_TIMEOUT_S", DUAL)
        self.assertIn("asyncio.wait_for", DUAL)

    def test_empty_state_paints_wait_seats(self) -> None:
        self.assertIn("def _empty_state", COUNCIL)
        self.assertIn("self._wait_agent_shell(reason)", COUNCIL)
        self.assertIn('"direction": "WAIT"', COUNCIL)

    def test_get_state_never_ships_empty_agents(self) -> None:
        self.assertIn("if not agents:", COUNCIL)
        self.assertIn("return self.ensure_seat_shell", COUNCIL)
        self.assertIn('live.get("agents") or self._wait_agent_shell', COUNCIL)


class SwUnstickTests(unittest.TestCase):
    def test_sw_does_not_precache_root(self) -> None:
        self.assertNotIn('"/",', SW.split("const PRECACHE")[1].split("];")[0])
        self.assertIn("isDocument", SW)
        self.assertIn('cache: "no-store"', SW)
        self.assertIn("20260821h", SW)

    def test_assembler_drops_old_workers(self) -> None:
        self.assertIn("getRegistrations", ASSEMBLER)
        self.assertIn("unregister", ASSEMBLER)
        self.assertIn("caches.delete", ASSEMBLER)
        self.assertIn("Clear data", ASSEMBLER)
        self.assertIn("passwordSubmit", ASSEMBLER)


class DeskHtmlTests(unittest.TestCase):
    def test_summon_not_disabled_and_hit_rate_admin_only(self) -> None:
        html = _desk_html()
        self.assertIn('id="passwordSubmit"', html)
        open_tag = html.split('id="passwordSubmit"', 1)[1].split(">", 1)[0]
        self.assertNotIn(" disabled", open_tag)
        self.assertNotIn('disabled="true"', open_tag)
        self.assertIn('aria-disabled="false"', open_tag)
        badge = html.split('id="accuracyBadge"', 1)[1].split(">", 1)[0]
        self.assertIn("hidden", badge)
        self.assertIn("acc-locked", badge)
        card = html.split('id="hitRateCard"', 1)[1].split(">", 1)[0]
        self.assertIn("hidden", card)
        self.assertIn("sw.js?v=20260821h", html)
        self.assertIn("roundtable.js?v=20260821h", html)
        self.assertIn("desk-fx.js?v=20260821h", html)
        self.assertIn("updateViaCache", html)

    def test_gate_is_an_oath_not_a_password(self) -> None:
        html = _desk_html()
        self.assertIn("Public paper Stream", html)
        self.assertNotIn('id="passwordInput"', html)
        self.assertNotIn('value="council"', html)
        agree = html.split('id="gateAgree"', 1)[1].split(">", 1)[0]
        self.assertNotIn("checked", agree)
        self.assertIn("oath: true", html)
        self.assertNotIn("campus-tab.css", html)
        self.assertNotIn("zt-intro.mp4", html)
        self.assertNotIn("money-rain.mp4", html)
        self.assertNotIn('rel="preload" as="image" href="/static/bots/', html)
        seat = (ROOT / "frontend" / "static" / "seat.js").read_text(encoding="utf-8")
        self.assertIn("oath: true", seat)
        self.assertNotIn('"council"', seat)
        access = (ROOT / "backend" / "services" / "desk_access.py").read_text(encoding="utf-8")
        self.assertIn("if oath is True", access)
        self.assertNotIn('== "council"', access)

    def test_crowd_and_flow_portraits_exist(self) -> None:
        self.assertTrue((PORTRAITS / "crowd.webp").is_file())
        self.assertTrue((PORTRAITS / "flow.webp").is_file())
        self.assertGreater((PORTRAITS / "crowd.webp").stat().st_size, 2000)
        self.assertGreater((PORTRAITS / "flow.webp").stat().st_size, 2000)


class RoundtableParseTests(unittest.TestCase):
    def test_is_phone_desk_is_a_real_function(self) -> None:
        self.assertIn("function isPhoneDesk()", ROUNDTABLE)
        after = ROUNDTABLE.split("function defaultLandMode()", 1)[1]
        self.assertLess(after.find("function isPhoneDesk()"), after.find("function floorIsSingle()"))
        self.assertGreater(after.find("function isPhoneDesk()"), 0)

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

    def test_trailing_iifes_live_in_desk_fx(self) -> None:
        fx = (ROOT / "frontend" / "static" / "desk-fx.js").read_text(encoding="utf-8")
        self.assertNotIn("initFloorMoneyRain", ROUNDTABLE)
        self.assertIn("initFloorMoneyRain", fx)
        self.assertIn("initFloorMusic", fx)
        self.assertIn("wireSettingsSaveFallback", fx)
        self.assertIn("/desk-fx.js", (ROOT / "backend" / "main.py").read_text(encoding="utf-8"))

    def test_deploy_runs_parse_check(self) -> None:
        self.assertIn("scripts/check.py", RENDER)
        check_sh = (ROOT / "scripts" / "check.sh").read_text(encoding="utf-8")
        self.assertIn("node --check frontend/static/roundtable.js", check_sh)
        self.assertIn("node --check frontend/static/desk-fx.js", check_sh)

    def test_admin_password_is_not_in_the_browser(self) -> None:
        self.assertNotIn("5152622439", ROUNDTABLE)
        self.assertNotIn("ADMIN_PASSWORD", ROUNDTABLE)
        self.assertNotIn("window.ADMIN_PASSWORD", ROUNDTABLE)
        self.assertNotIn("?admin=", ROUNDTABLE)
        self.assertIn("/api/admin/verify", ROUNDTABLE)
        html = _desk_html()
        self.assertNotIn("5152622439", html)
        self.assertNotIn("?admin=", html)


if __name__ == "__main__":
    unittest.main()
