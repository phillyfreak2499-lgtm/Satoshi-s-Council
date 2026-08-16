"""Side Table: 15m arcade + hot strip. Paper default. No Follower."""
from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from backend.services import desk_side

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
SIDE = (ROOT / "backend" / "services" / "desk_side.py").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
FOLLOWER = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
LEADER = (ROOT / "backend" / "agents" / "leader.py").read_text(encoding="utf-8")

NOW = datetime(2026, 8, 15, 16, 5, tzinfo=timezone.utc)


def _m(
    ticker: str,
    *,
    series: str | None = None,
    title: str = "",
    yes_bid: str = "0.48",
    yes_ask: str = "0.50",
    volume: str = "12000",
    close_in: int = 600,
    strike: float | None = 100000,
    result: str | None = None,
    status: str = "active",
) -> dict:
    row = {
        "ticker": ticker,
        "series_ticker": series or ticker.split("-", 1)[0],
        "title": title or ticker,
        "yes_bid_dollars": yes_bid,
        "yes_ask_dollars": yes_ask,
        "volume_fp": volume,
        "close_time": (NOW + timedelta(seconds=close_in)).isoformat(),
        "status": status,
    }
    if strike is not None:
        row["floor_strike"] = strike
    if result:
        row["result"] = result
    return row


def _fetch_factory(extra: dict | None = None):
    extra = extra or {}

    async def fetch(path: str, params: dict):
        if path.startswith("/markets/") and path != "/markets":
            tick = path.rsplit("/", 1)[-1]
            return {"market": extra.get("by_ticker", {}).get(tick) or {"ticker": tick}}
        series = str((params or {}).get("series_ticker") or "")
        status = str((params or {}).get("status") or "open")
        if not series:
            return {"markets": extra.get("hot") or []}
        key = f"{series}:{status}"
        canned = extra.get(key)
        if canned is not None:
            return {"markets": canned}
        if series == "KXBTC15M" and status == "open":
            return {"markets": [_m("KXBTC15M-26AUG151610-T100000", series="KXBTC15M", title="BTC up 15m")]}
        if series == "KXETH15M" and status == "open":
            return {"markets": [_m("KXETH15M-26AUG151610-T4000", series="KXETH15M", title="ETH up 15m", strike=4000)]}
        if series == "KXBTC15M" and status == "settled":
            return {"markets": [
                _m("KXBTC15M-OLD1", series="KXBTC15M", result="yes", close_in=-900),
                _m("KXBTC15M-OLD2", series="KXBTC15M", result="no", close_in=-1800),
                _m("KXBTC15M-OLD3", series="KXBTC15M", result="yes", close_in=-2700),
                _m("KXBTC15M-OLD4", series="KXBTC15M", result="no", close_in=-3600),
            ]}
        if series == "KXETH15M" and status == "settled":
            return {"markets": [
                _m("KXETH15M-OLD1", series="KXETH15M", result="no", close_in=-900),
                _m("KXETH15M-OLD2", series="KXETH15M", result="yes", close_in=-1800),
            ]}
        return {"markets": []}

    return fetch


class SideMarkupTests(unittest.TestCase):
    def test_tab_and_view_exist(self):
        self.assertIn('id="tabSide"', HTML)
        self.assertIn('data-mode="side"', HTML)
        self.assertIn('id="sideView"', HTML)
        self.assertIn("SIDE TABLE", HTML)
        self.assertIn("PAPER", HTML)
        self.assertIn("Never talks to Follower", HTML)
        self.assertIn("Does not lock the 1H Chair", HTML)
        self.assertLess(HTML.find('id="tabSchool"'), HTML.find('id="tabSide"'))
        self.assertLess(HTML.find('id="tabSide"'), HTML.find('id="tabCharts"'))
        self.assertIn("hidden", HTML.split('id="tabSide"', 1)[1][:80])
        self.assertIn('document.body.classList.add("side-tab-off")', JS)
        self.assertIn("body.side-tab-off #tabSide", CSS)
        self.assertNotIn("/oracle-room.jpg", HTML.split('id="sideView"', 1)[1][:2000])

    def test_not_behind_follower_passwords(self):
        self.assertNotIn("tabFollower", HTML)
        self.assertNotIn("FOLLOWER_PASSWORD", HTML)
        self.assertNotIn("/api/follower/unlock", HTML)
        self.assertNotIn("/api/follower/order", JS)
        self.assertIn("function loadSideTable()", JS)
        self.assertIn("/api/side", JS)
        self.assertIn("/api/side/tap", JS)
        self.assertNotIn("follower_gate", JS)

    def test_css_and_night_hide(self):
        self.assertIn("body.mode-side #tabSide", CSS)
        self.assertIn("body.night-mode #tabSide", CSS)
        self.assertIn("body.mode-settings #sideView", CSS)
        self.assertIn("min-height: 56px", CSS)

    def test_routes_before_unknown(self):
        self.assertIn('@app.get("/api/side")', MAIN)
        self.assertIn('@app.post("/api/side/tap")', MAIN)
        self.assertIn('@app.post("/api/side/arm")', MAIN)
        self.assertIn('@app.post("/api/side/kill")', MAIN)
        self.assertGreater(MAIN.find("api_unknown"), MAIN.find('/api/side'))

    def test_no_zt_and_no_auto_bets(self):
        self.assertNotIn("ZT ·", SIDE)
        self.assertNotIn("ZT ·", HTML)
        self.assertIn("Never auto-bets", HTML)
        self.assertIn("auto_bets", SIDE)
        self.assertIn('"auto_bets": False', SIDE)

    def test_does_not_touch_follower_or_chair(self):
        self.assertNotIn("from backend.services.follower_gate", SIDE)
        self.assertNotIn("from backend.services.follower", SIDE)
        self.assertNotIn("desk_side", FOLLOWER)
        self.assertNotIn("desk_side", GATES)
        self.assertNotIn("desk_side", LEADER)
        self.assertIn("def decide_open_lock_grade", GATES)
        self.assertIn("Does not place Chair 1H locks", SIDE)


class SideQuoteTests(unittest.TestCase):
    def test_paper_uses_ask_fee_and_half_spread(self):
        q = desk_side.paper_quote("YES", 48, 50)
        self.assertTrue(q["ok"])
        self.assertEqual(q["ask"], 50)
        self.assertGreater(q["fee_cents"], 0)
        self.assertEqual(q["half_spread"], 1.0)
        self.assertGreater(q["fill_cents"], 50)

    def test_why_only_real_tells(self):
        self.assertEqual(desk_side.why_line({"empty": True}, 400, 60), "Don’t play · empty book")
        self.assertEqual(desk_side.why_line({"sick": True}, 400, 60), "Don’t play · sick book")
        self.assertEqual(desk_side.why_line({"wall_99": True}, 400, 60), "Don’t play · ≥99¢ wall")
        self.assertEqual(desk_side.why_line({"spread": 8}, 400, 60), "Don’t play · junk spread")
        self.assertEqual(desk_side.why_line({}, 20, 60), "Don’t play · last-minute cutoff")
        self.assertIsNone(desk_side.why_line({"spread": 2}, 400, 60))


class SideBoardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        desk_side.reset_for_tests(self.tmp)
        os.environ.pop("SIDE_TABLE_LIVE", None)
        os.environ.pop("SIDE_TABLE_KILL", None)

    async def test_btc_15m_only_second_parked(self):
        board = await desk_side.build_board(fetch=_fetch_factory(), now=NOW)
        assets = [c["asset"] for c in board["arcade"]]
        self.assertEqual(assets, ["BTC"])
        self.assertNotIn("ETH", assets)
        self.assertNotIn("GOLD", assets)
        self.assertTrue(board["parked"])
        self.assertEqual(board["parked"][0]["status"], "parked")
        self.assertTrue(all(c["minutes"] == 15 for c in board["arcade"]))
        self.assertTrue(all(c["ticker"].startswith("KX") for c in board["arcade"]))
        btc = next(c for c in board["arcade"] if c["asset"] == "BTC")
        self.assertGreaterEqual(len(btc["tape"]), 4)
        self.assertIn(btc["tape"][0]["result"], ("HIT", "MISS"))
        self.assertEqual(board["pills_5m"], [])
        self.assertFalse(board["follower"])
        self.assertTrue(board["status"]["paper_default"])
        self.assertFalse(board["status"]["armed"])
        self.assertEqual(desk_side.ARCADE_ASSETS, ("BTC",))
        self.assertNotIn("GOLD", desk_side.ARCADE_ASSETS)

    async def test_hot_strip_excludes_chair_1h_and_dead_books(self):
        hot = [
            _m("KXBTCD-26AUG1516-T100000", series="KXBTCD", title="BTC 1H Chair", volume="999999"),
            _m("KXETHD-26AUG1516-T4000", series="KXETHD", title="ETH 1H Chair", volume="999999"),
            _m("KXBTC15M-26AUG151610-T100000", series="KXBTC15M", title="arcade dup", volume="999999"),
            _m("DEAD-1", series="KXDEAD", title="junk", yes_bid="0.20", yes_ask="0.40", volume="50"),
            _m("KXNFLGAME-1", series="KXNFLGAME", title="Chiefs win", yes_bid="0.55", yes_ask="0.57", volume="88000"),
            _m("KXGOLDSM-1", series="KXGOLDSM", title="Gold up", yes_bid="0.44", yes_ask="0.46", volume="22000"),
        ]
        board = await desk_side.build_board(fetch=_fetch_factory({"hot": hot}), now=NOW)
        titles = [h["title"] for h in board["hot"]]
        self.assertIn("Chiefs win", titles)
        self.assertIn("Gold up", titles)
        self.assertNotIn("BTC 1H Chair", titles)
        self.assertNotIn("ETH 1H Chair", titles)
        self.assertNotIn("junk", titles)
        self.assertNotIn("arcade dup", titles)

    async def test_sol_skipped_when_illiquid(self):
        fetch = _fetch_factory({
            "KXSOL15M:open": [_m(
                "KXSOL15M-1",
                series="KXSOL15M",
                title="SOL 15m",
                yes_bid="0.40",
                yes_ask="0.55",
                volume="200",
            )],
        })
        board = await desk_side.build_board(fetch=fetch, now=NOW)
        self.assertEqual(board["extras"], [])

    async def test_5m_pill_only_when_live_open(self):
        fetch = _fetch_factory({
            "KXBTC5M:open": [_m("KXBTC5M-1", series="KXBTC5M", title="BTC 5m")],
        })
        board = await desk_side.build_board(fetch=fetch, now=NOW)
        self.assertEqual(board["pills_5m"], ["BTC"])

    async def test_paper_tap_works(self):
        out = await desk_side.tap(
            ticker="KXBTC15M-26AUG151610-T100000",
            side="YES",
            stake=10,
            live=False,
            yes_bid=48,
            yes_ask=50,
            secs_left=400,
            now=NOW,
        )
        self.assertTrue(out["ok"], out)
        self.assertTrue(out["fill"]["paper"])
        self.assertFalse(out["fill"]["live"])
        self.assertFalse(out["fill"]["follower"])
        self.assertEqual(out["fill"]["side"], "YES")
        self.assertEqual(out["fill"]["stake"], 10)
        self.assertGreater(out["fill"]["fill_cents"], 50)

    async def test_live_refused_until_armed(self):
        out = await desk_side.tap(
            ticker="KXBTC15M-1",
            side="NO",
            stake=5,
            live=True,
            yes_bid=48,
            yes_ask=50,
            secs_left=400,
            now=NOW,
        )
        self.assertFalse(out["ok"])
        self.assertIn("paper only", out["error"])

    async def test_kill_and_sick_and_chair_blocked(self):
        chair = await desk_side.tap(ticker="KXBTCD-26AUG1516-T1", side="YES", stake=5, yes_bid=48, yes_ask=50, secs_left=400)
        self.assertFalse(chair["ok"])
        self.assertIn("Chair 1H", chair["error"])
        sick = await desk_side.tap(ticker="KXBTC15M-1", side="YES", stake=5, yes_bid=48, yes_ask=50, secs_left=400, sick=True)
        self.assertFalse(sick["ok"])
        self.assertTrue(sick["dont_play"])
        late = await desk_side.tap(ticker="KXBTC15M-1", side="YES", stake=5, yes_bid=48, yes_ask=50, secs_left=10)
        self.assertFalse(late["ok"])
        desk_side.kill_live()
        with patch.dict(os.environ, {"SIDE_TABLE_LIVE": "1"}):
            armed = desk_side.arm_live("LIVE SIDE TABLE", now=NOW.timestamp())
            self.assertFalse(armed.get("ok"))
            self.assertTrue(desk_side.is_killed())

    async def test_arm_needs_env_and_phrase(self):
        miss = desk_side.arm_live("nope")
        self.assertFalse(miss.get("ok"))
        with patch.dict(os.environ, {"SIDE_TABLE_LIVE": "1"}):
            desk_side.reset_for_tests(self.tmp)
            bad = desk_side.arm_live("LIVE SIDE")
            self.assertFalse(bad.get("ok"))
            ok = desk_side.arm_live("LIVE SIDE TABLE", now=1000.0)
            self.assertTrue(ok.get("ok"), ok)
            self.assertTrue(ok.get("arming"))
            self.assertFalse(desk_side.is_armed(1000.0))
            self.assertTrue(desk_side.is_armed(1010.0))


if __name__ == "__main__":
    unittest.main()
