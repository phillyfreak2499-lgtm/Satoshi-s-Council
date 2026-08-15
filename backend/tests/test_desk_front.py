"""THE FRONT: city cards + FORECAST/MARKET/SKIP/CLIMO. Paper default. No Follower."""
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

NOW = datetime(2026, 8, 15, 16, 5, tzinfo=timezone.utc)


def _m(
    ticker: str,
    *,
    series: str = "KXHIGHTDAL",
    strike_type: str = "between",
    floor: float | None = 103,
    cap: float | None = 104,
    yes_bid: str = "0.48",
    yes_ask: str = "0.50",
    volume: str = "4200",
) -> dict:
    return {
        "ticker": ticker,
        "series_ticker": series,
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
        if extra.get("missing_all"):
            return {"markets": [], "missing": True}
        if extra.get(series) == "404":
            return {"markets": [], "missing": True}
        canned = extra.get(series)
        if isinstance(canned, list):
            return {"markets": canned}
        if series == "KXHIGHCHI":
            return {"markets": [_m("KXHIGHCHI-26AUG15-B8384", series=series, floor=83, cap=84)]}
        if series == "KXHIGHNY":
            return {"markets": [_m("KXHIGHNY-26AUG15-B8485", series=series, floor=84, cap=85)]}
        if series == "KXHIGHTDAL":
            return {"markets": [_m("KXHIGHTDAL-26AUG15-B103104", series=series, floor=103, cap=104)]}
        if series == "KXHIGHMIA":
            return {"markets": extra.get("MIA") or []}
        return {"markets": []}

    return fetch


async def _nws(url: str):
    station = "KMDW"
    high = 83
    if "/stations/KNYC" in url:
        station, high = "KNYC", 84
    elif "/stations/KDFW" in url:
        station, high = "KDFW", 103
    elif "/stations/KMIA" in url:
        station, high = "KMIA", 90
    if "/stations/" in url and "/observations" not in url and "/points" not in url:
        return {"geometry": {"coordinates": [-87.75, 41.78]}}
    if "/points/" in url:
        return {"properties": {"forecast": "https://api.weather.gov/gridpoints/X/1,1/forecast"}}
    if "forecast" in url:
        return {"properties": {"periods": [
            {"isDaytime": True, "startTime": "2026-08-15T06:00:00-05:00", "temperature": high, "temperatureUnit": "F"},
        ]}}
    return {}


class FrontMarkupTests(unittest.TestCase):
    def test_tab_city_cards_and_four_seats(self):
        self.assertIn('id="tabFront"', HTML)
        self.assertIn('data-mode="front"', HTML)
        self.assertIn('id="frontView"', HTML)
        self.assertIn("THE FRONT", HTML)
        self.assertIn("FORECAST", HTML)
        self.assertIn("MARKET", HTML)
        self.assertIn("SKIP", HTML)
        self.assertIn("CLIMO", HTML)
        self.assertIn("CHI Midway", HTML)
        self.assertIn("NYC Central Park", HTML)
        self.assertIn("DAL DFW", HTML)
        self.assertNotIn("RAIJIN", HTML)
        self.assertNotIn("GLASS", HTML)
        self.assertNotIn('id="floorRaijin"', HTML)
        self.assertNotIn('id="frontRing"', HTML)
        self.assertLess(HTML.find('id="tabSide"'), HTML.find('id="tabFront"'))
        self.assertIn('btn.textContent = spinning ? "SPIN" : "STILL"', JS)

    def test_settings_tutorial_no_zt(self):
        self.assertIn("THE FRONT", HTML)
        self.assertIn("Does not place 1H Chair locks", HTML)
        self.assertIn('title: "THE FRONT"', JS)
        self.assertIn("FORECAST, MARKET, SKIP, and CLIMO vote", JS)
        self.assertNotIn("ZT ·", FRONT)
        self.assertNotIn("ZT ·", HTML)
        self.assertNotIn("tabFollower", HTML)
        self.assertNotIn("follower_gate", JS)
        self.assertIn("Never auto-bets", HTML)

    def test_css_routes_and_isolation(self):
        self.assertIn("body.mode-front #tabFront", CSS)
        self.assertIn("body.night-mode #tabFront", CSS)
        self.assertIn("front-honesty", CSS)
        self.assertIn('@app.get("/api/front")', MAIN)
        self.assertGreater(MAIN.find("api_unknown"), MAIN.find("/api/front"))
        self.assertNotIn("from backend.services.follower_gate", FRONT)
        self.assertNotIn("desk_front", FOLLOWER)
        self.assertNotIn("desk_front", GATES)
        self.assertNotIn("desk_front", LEADER)
        self.assertIn("ARCADE_ASSETS = (\"BTC\",)", SIDE)
        self.assertNotIn("KXGOLD15M", FRONT)
        self.assertNotIn("KXGOLD15M", SIDE)


class FrontBoardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        desk_front.reset_for_tests(self.tmp)
        os.environ.pop("FRONT_LIVE", None)
        os.environ.pop("FRONT_KILL", None)

    async def test_required_cities_vote_and_best(self):
        board = await desk_front.build_board(fetch=_fetch_factory(), nws=_nws, now=NOW)
        cities = [c["city"] for c in board["cards"]]
        self.assertEqual(set(cities), {"CHI", "NYC", "DAL"})
        self.assertTrue(any(c.get("best") for c in board["cards"]))
        self.assertEqual([s["id"] for s in board["seats"]], ["FORECAST", "MARKET", "SKIP", "CLIMO"])
        card = board["cards"][0]
        self.assertEqual([v["id"] for v in card["votes"]], ["FORECAST", "MARKET", "SKIP", "CLIMO"])
        self.assertIn("ev_cents", card["honesty"])
        self.assertIn("sample_n", card["honesty"])
        self.assertIn("dont_play", card["honesty"])
        self.assertFalse(board["follower"])
        self.assertTrue(board["status"]["paper_default"])
        confs = [c["confidence"] for c in board["cards"]]
        self.assertEqual(confs, sorted(confs, reverse=True))

    async def test_404_drops_and_optional_needs_liquid(self):
        fetch = _fetch_factory({
            "KXHIGHCHI": "404",
            "KXHIGHMIA": [_m("KXHIGHMIA-26AUG15-B8990", series="KXHIGHMIA", floor=89, cap=90, volume="50", yes_bid="0.20", yes_ask="0.40")],
        })
        board = await desk_front.build_board(fetch=fetch, nws=_nws, now=NOW)
        self.assertIn("KXHIGHCHI", board["dropped"])
        cities = [c["city"] for c in board["cards"]]
        self.assertNotIn("CHI", cities)
        self.assertNotIn("MIA", cities)
        self.assertIn("NYC", cities)
        self.assertIn("DAL", cities)

    async def test_inclusive_bracket_and_date(self):
        self.assertEqual(desk_front.date_from_ticker("KXHIGHTDAL-26AUG15-B103104"), date(2026, 8, 15))
        m = _m("KXHIGHTDAL-26AUG15-B103104")
        self.assertGreater(desk_front.forecast_p(103, m), 0.5)
        self.assertGreater(desk_front.forecast_p(104, m), 0.5)
        self.assertLess(desk_front.forecast_p(100, m), 0.3)

    async def test_paper_tap_live_off_chair_blocked(self):
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
