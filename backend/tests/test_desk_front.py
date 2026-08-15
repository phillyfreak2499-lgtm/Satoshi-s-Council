"""THE FRONT: Dallas-only weather council. Paper default. No Follower."""
from __future__ import annotations

import os
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

from backend.services import desk_front

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
FRONT = (ROOT / "backend" / "services" / "desk_front.py").read_text(encoding="utf-8")
SIDE = (ROOT / "backend" / "services" / "desk_side.py").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
FOLLOWER = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
LEADER = (ROOT / "backend" / "agents" / "leader.py").read_text(encoding="utf-8")
BOTS = ROOT / "frontend" / "static" / "bots"

NOW = datetime(2026, 8, 15, 16, 5, tzinfo=timezone.utc)


def _m(
    ticker: str,
    *,
    strike_type: str = "between",
    floor: float | None = 103,
    cap: float | None = 104,
    yes_bid: str = "0.48",
    yes_ask: str = "0.50",
    volume: str = "4200",
) -> dict:
    return {
        "ticker": ticker,
        "series_ticker": "KXHIGHTDAL",
        "title": ticker,
        "strike_type": strike_type,
        "floor_strike": floor,
        "cap_strike": cap,
        "yes_bid_dollars": yes_bid,
        "yes_ask_dollars": yes_ask,
        "volume_fp": volume,
        "status": "active",
    }


def _fetch_factory(extra: dict | None = None):
    extra = extra or {}

    async def fetch(path: str, params: dict):
        series = str((params or {}).get("series_ticker") or "")
        if extra.get("missing") or extra.get(series) == "404":
            return {"markets": [], "missing": True}
        if series == "KXHIGHTDAL":
            return {"markets": extra.get("rows") or [
                _m("KXHIGHTDAL-26AUG15-B103104"),
                _m("KXHIGHTDAL-26AUG15-B101102", floor=101, cap=102, yes_bid="0.22", yes_ask="0.24"),
            ]}
        return {"markets": []}

    return fetch


async def _nws_high_only(url: str):
    if "/stations/KDFW" in url and "/observations" not in url:
        return {"geometry": {"coordinates": [-97.02196, 32.89743]}}
    if "/points/" in url:
        return {"properties": {"forecast": "https://api.weather.gov/gridpoints/FWD/1,1/forecast"}}
    if "forecast" in url:
        return {"properties": {"periods": [
            {"isDaytime": True, "startTime": "2026-08-15T06:00:00-05:00", "temperature": 103, "temperatureUnit": "F"},
        ]}}
    return {}


class FrontMarkupTests(unittest.TestCase):
    def test_tab_and_ring_not_city_list(self):
        self.assertIn('id="tabFront"', HTML)
        self.assertIn('data-mode="front"', HTML)
        self.assertIn('id="frontView"', HTML)
        self.assertIn("THE FRONT", HTML)
        self.assertIn("id=\"frontRing\"", HTML)
        self.assertIn("RAIJIN", HTML)
        self.assertIn("GLASS", HTML)
        self.assertIn("PIT", HTML)
        self.assertIn("FROST", HTML)
        self.assertIn("BONE", HTML)
        self.assertNotIn("FORECAST", HTML)
        self.assertNotIn("CLIMO", HTML)
        self.assertNotIn("CHI / NY", HTML)
        self.assertNotIn("KXHIGHTCHI", HTML)
        self.assertLess(HTML.find('id="tabSide"'), HTML.find('id="tabFront"'))
        self.assertLess(HTML.find('id="tabFront"'), HTML.find('id="tabCharts"'))

    def test_bot_marks_are_pngs_no_letter_fallback(self):
        for name in ("glass.png", "pit.png", "frost.png", "bone.png", "raijin-chair.png"):
            path = BOTS / name
            self.assertTrue(path.is_file(), name)
            self.assertGreater(path.stat().st_size, 1000)
        self.assertIn("/static/bots/glass.png", HTML)
        self.assertIn("/static/bots/pit.png", HTML)
        self.assertIn("/static/bots/frost.png", HTML)
        self.assertIn("/static/bots/bone.png", HTML)
        self.assertIn("frontMarkFail", JS)
        self.assertIn("front-mark.blank", CSS)
        self.assertNotIn("front-letter", HTML + JS + CSS)
        self.assertNotIn('textContent = "G"', JS)
        self.assertNotIn('textContent = "P"', JS)
        self.assertNotIn('textContent = "F"', JS)
        self.assertNotIn('textContent = "B"', JS)

    def test_settings_and_tutorial(self):
        self.assertIn("RAIJIN · THE FRONT", HTML)
        self.assertIn("Does not place 1H Chair locks", HTML)
        self.assertIn('title: "THE FRONT"', JS)
        self.assertIn("Weather page — not the crypto Floor", JS)

    def test_floor_raijin_small_presence(self):
        self.assertIn('id="floorRaijin"', HTML)
        self.assertIn("floor-raijin", CSS)
        self.assertIn("function syncSeatSpinBtn", JS)
        self.assertIn('btn.textContent = spinning ? "SPIN" : "STILL"', JS)

    def test_not_behind_follower_and_no_zt(self):
        self.assertNotIn("tabFollower", HTML)
        self.assertNotIn("FOLLOWER_PASSWORD", HTML)
        self.assertNotIn("/api/follower/unlock", HTML)
        self.assertNotIn("/api/follower/order", JS)
        self.assertNotIn("follower_gate", JS)
        self.assertNotIn("ZT ·", FRONT)
        self.assertNotIn("ZT ·", HTML)
        self.assertIn("Never auto-bets", HTML)

    def test_css_and_routes(self):
        self.assertIn("body.mode-front #tabFront", CSS)
        self.assertIn("body.night-mode #tabFront", CSS)
        self.assertIn("body.mode-settings #frontView", CSS)
        self.assertIn("min-height: 56px", CSS)
        self.assertIn('@app.get("/api/front")', MAIN)
        self.assertIn('@app.post("/api/front/tap")', MAIN)
        self.assertGreater(MAIN.find("api_unknown"), MAIN.find("/api/front"))

    def test_does_not_touch_follower_or_chair(self):
        self.assertNotIn("from backend.services.follower_gate", FRONT)
        self.assertNotIn("from backend.services.follower", FRONT)
        self.assertNotIn("desk_front", FOLLOWER)
        self.assertNotIn("desk_front", GATES)
        self.assertNotIn("desk_front", LEADER)
        self.assertIn("Does not place Chair 1H locks", FRONT)
        self.assertNotIn("KXGOLD15M", FRONT)
        self.assertNotIn("ARCADE_ASSETS = (\"BTC\", \"GOLD\")", SIDE)
        self.assertIn("ARCADE_ASSETS = (\"BTC\",)", SIDE)


class FrontWeatherTests(unittest.TestCase):
    def test_classify_modes(self):
        self.assertEqual(desk_front.classify_weather({"text": "Thunderstorm", "raw": "KDFW TS", "temp_f": 88}), "STORM")
        self.assertEqual(desk_front.classify_weather({"text": "Heavy rain", "raw": "KDFW +RA", "temp_f": 76}), "STORM")
        self.assertEqual(desk_front.classify_weather({"text": "Light rain", "raw": "KDFW -RA", "temp_f": 74}), "RAIN")
        self.assertEqual(desk_front.classify_weather({"text": "Clear", "raw": "SKC", "temp_f": 101}), "HEAT")
        self.assertEqual(desk_front.classify_weather({"text": "Clear", "raw": "CLR", "temp_f": 82}), "SUN")
        self.assertEqual(desk_front.classify_weather({"text": "Overcast", "raw": "OVC", "temp_f": 80}), "CLOUD")
        self.assertEqual(desk_front.classify_weather({"text": "Fair", "raw": "CLR", "temp_f": 70, "wind_kt": 24}), "WIND")
        self.assertIsNone(desk_front.classify_weather(None))
        self.assertIsNone(desk_front.classify_weather({}))

    def test_hold_last_mode_when_feed_dead(self):
        desk_front.reset_for_tests(Path(tempfile.mkdtemp()))
        live = desk_front.remember_weather({"text": "Clear", "raw": "CLR", "temp_f": 82, "station": "KDFW"})
        self.assertEqual(live["mode"], "SUN")
        self.assertFalse(live["held"])
        held = desk_front.remember_weather(None)
        self.assertEqual(held["mode"], "SUN")
        self.assertTrue(held["held"])
        self.assertFalse(held["live"])


class FrontBoardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        desk_front.reset_for_tests(self.tmp)
        os.environ.pop("FRONT_LIVE", None)
        os.environ.pop("FRONT_KILL", None)

    async def test_dallas_only_named_seats(self):
        board = await desk_front.build_board(
            fetch=_fetch_factory(),
            nws=_nws_high_only,
            now=NOW,
            wx_obs={"text": "Clear", "raw": "CLR", "temp_f": 101, "wind_kt": 6},
        )
        self.assertEqual(board["city"]["station"], "KDFW")
        self.assertEqual(board["city"]["series"], "KXHIGHTDAL")
        self.assertNotIn("cards", board)
        ids = [s["id"] for s in board["seats"]]
        self.assertEqual(ids, ["GLASS", "PIT", "FROST", "BONE"])
        self.assertEqual(board["chair"]["id"], "RAIJIN")
        self.assertTrue(all(s["mark"].endswith(".png") for s in board["seats"]))
        self.assertTrue(board["chair"]["mark"].endswith("raijin-chair.png"))
        self.assertEqual(board["weather"]["mode"], "HEAT")
        self.assertFalse(board["follower"])
        self.assertTrue(board["status"]["paper_default"])
        self.assertIn("KXHIGHTDAL-26AUG15-B103104", [b["ticker"] for b in board["brackets"]])
        self.assertTrue(any(b.get("best") for b in board["brackets"]))

    async def test_404_drops_series(self):
        board = await desk_front.build_board(
            fetch=_fetch_factory({"missing": True}),
            nws=_nws_high_only,
            now=NOW,
            wx_obs={"text": "Overcast", "raw": "OVC", "temp_f": 80},
        )
        self.assertIn("KXHIGHTDAL", board["dropped"])
        self.assertEqual(board["brackets"], [])
        self.assertIsNone(board["best"])
        self.assertEqual([s["id"] for s in board["seats"]], ["GLASS", "PIT", "FROST", "BONE"])

    async def test_inclusive_bracket_and_date_in_ticker(self):
        self.assertEqual(desk_front.date_from_ticker("KXHIGHTDAL-26AUG15-B103104"), date(2026, 8, 15))
        m = _m("KXHIGHTDAL-26AUG15-B103104")
        self.assertGreater(desk_front.forecast_p(103, m), 0.5)
        self.assertGreater(desk_front.forecast_p(104, m), 0.5)
        self.assertLess(desk_front.forecast_p(100, m), 0.3)

    async def test_paper_tap_and_live_off(self):
        ok = await desk_front.tap(
            ticker="KXHIGHTDAL-26AUG15-B103104",
            side="YES",
            stake=10,
            live=False,
            yes_bid=48,
            yes_ask=50,
            now=NOW,
        )
        self.assertTrue(ok["ok"], ok)
        self.assertTrue(ok["fill"]["paper"])
        self.assertFalse(ok["fill"]["live"])
        self.assertFalse(ok["fill"]["follower"])
        live = await desk_front.tap(
            ticker="KXHIGHTDAL-26AUG15-B103104",
            side="YES",
            stake=5,
            live=True,
            yes_bid=48,
            yes_ask=50,
            now=NOW,
        )
        self.assertFalse(live["ok"])
        self.assertIn("paper only", live["error"])
        chair = await desk_front.tap(ticker="KXBTCD-26AUG1516-T1", side="YES", stake=5, yes_bid=48, yes_ask=50)
        self.assertFalse(chair["ok"])
        self.assertIn("Chair 1H", chair["error"])

    async def test_arm_phrase(self):
        miss = desk_front.arm_live("nope")
        self.assertFalse(miss.get("ok"))
        with patch.dict(os.environ, {"FRONT_LIVE": "1"}):
            desk_front.reset_for_tests(self.tmp)
            ok = desk_front.arm_live("LIVE THE FRONT", now=1000.0)
            self.assertTrue(ok.get("ok"), ok)
            self.assertTrue(ok.get("arming"))
            self.assertFalse(desk_front.is_armed(1000.0))
            self.assertTrue(desk_front.is_armed(1010.0))


if __name__ == "__main__":
    unittest.main()
