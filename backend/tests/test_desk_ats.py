"""Ares ATS sports Chair. Paper only. No Follower. Four equal Floor chairs."""
from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from backend.services import desk_ats

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
ATS = (ROOT / "backend" / "services" / "desk_ats.py").read_text(encoding="utf-8")
FOLLOWER = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
LEADER = (ROOT / "backend" / "agents" / "leader.py").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
BOTS = ROOT / "frontend" / "static" / "bots"
STATIC = ROOT / "frontend" / "static"

NOW = datetime(2026, 8, 15, 20, 0, tzinfo=timezone.utc)  # Saturday — CFB first if liquid


def _m(
    ticker: str,
    *,
    series: str = "KXNFLGAME",
    event: str | None = None,
    title: str | None = None,
    yes_bid: str = "0.44",
    yes_ask: str = "0.46",
    volume: str = "4200",
    oi: str = "3900",
    floor: float | None = None,
    close: str = "2026-08-16T00:00:00Z",
    status: str = "active",
) -> dict:
    return {
        "ticker": ticker,
        "series_ticker": series,
        "event_ticker": event or ticker.rsplit("-", 1)[0],
        "title": title or ticker,
        "yes_bid_dollars": yes_bid,
        "yes_ask_dollars": yes_ask,
        "volume_fp": volume,
        "open_interest_fp": oi,
        "floor_strike": floor,
        "close_time": close,
        "status": status,
    }


def _fetch_factory(extra: dict | None = None):
    extra = extra or {}

    async def fetch(path: str, params: dict):
        series = str((params or {}).get("series_ticker") or "")
        if extra.get("missing") or extra.get(series) == "404":
            return {"markets": [], "missing": True}
        rows = extra.get(series)
        if rows == "404":
            return {"markets": [], "missing": True}
        if isinstance(rows, list):
            return {"markets": rows}
        alias = {
            "KXNFLGAME": "nfl_ml",
            "KXNFLSPREAD": "nfl_spread",
            "KXNFLTOTAL": "nfl_total",
            "KXNCAAFGAME": "cfb",
        }
        key = alias.get(series)
        if key and key in extra:
            got = extra.get(key)
            if got == "404":
                return {"markets": [], "missing": True}
            return {"markets": got if isinstance(got, list) else []}
        if series == "KXNFLGAME":
            return {"markets": [
                _m("KXNFLGAME-26AUG15DALSEA-SEA", event="KXNFLGAME-26AUG15DALSEA",
                   title="Will Seattle win the Dallas vs Seattle Pro Football game?",
                   yes_bid="0.58", yes_ask="0.59", volume="94000"),
                _m("KXNFLGAME-26AUG15DALSEA-DAL", event="KXNFLGAME-26AUG15DALSEA",
                   title="Will Dallas win the Dallas vs Seattle Pro Football game?",
                   yes_bid="0.40", yes_ask="0.41", volume="74000"),
            ]}
        if series == "KXNFLSPREAD":
            return {"markets": [
                _m("KXNFLSPREAD-26AUG15DALSEA-SEA7", series=series,
                   event="KXNFLSPREAD-26AUG15DALSEA",
                   title="Seattle wins by over 6.5 points?",
                   yes_bid="0.44", yes_ask="0.46", volume="1515", floor=6.5),
            ]}
        if series == "KXNFLTOTAL":
            return {"markets": [
                _m("KXNFLTOTAL-26AUG15DALSEA-47", series=series,
                   event="KXNFLTOTAL-26AUG15DALSEA",
                   title="Will there be over 46.5 points scored?",
                   yes_bid="0.48", yes_ask="0.50", volume="6200", floor=46.5),
            ]}
        return {"markets": []}

    return fetch


class AtsMarkupTests(unittest.TestCase):
    def test_gold_row_is_btc_eth_dwf_ats(self):
        self.assertIn('id="focusAts"', HTML)
        self.assertIn(">ATS</button>", HTML)
        self.assertIn('title="Focus ATS / Ares"', HTML)
        self.assertIn('aria-label="Focus ATS / Ares"', HTML)
        self.assertIn('data-focus="ats"', HTML)
        row = HTML.split('id="modeTabs"', 1)[1].split('id="tabFloor"', 1)[0]
        self.assertIn("focusBtc", row)
        self.assertIn("focusEth", row)
        self.assertIn("focusFront", row)
        self.assertIn("focusAts", row)
        self.assertIn(">DWF</button>", row)
        self.assertIn(">ATS</button>", row)
        self.assertNotIn(">RAIJIN</button>", row)
        self.assertNotIn("ZT", HTML.split('id="focusAts"', 1)[1].split("</button>", 1)[0])
        self.assertNotIn("ZT", HTML.split('id="focusFront"', 1)[1].split("</button>", 1)[0])

    def test_art_files_land_where_asked(self):
        self.assertTrue((STATIC / "ares-chair.png").is_file())
        self.assertGreater((STATIC / "ares-chair.png").stat().st_size, 1000)
        self.assertTrue((STATIC / "ares-wait.png").is_file())
        for name in ("line.png", "steam.png", "fade.png", "hurt.png", "ice.png"):
            path = BOTS / name
            self.assertTrue(path.is_file(), name)
            self.assertGreater(path.stat().st_size, 1000)
        self.assertIn("/static/ares-chair.png", HTML + JS + ATS)
        self.assertIn("/static/bots/line.png", HTML + JS + ATS)
        self.assertIn("/static/bots/steam.png", HTML + JS + ATS)
        self.assertIn("/static/bots/fade.png", HTML + JS + ATS)
        self.assertIn("/static/bots/hurt.png", HTML + JS + ATS)
        self.assertIn("/static/bots/ice.png", HTML + JS + ATS)

    def test_sports_roster_not_crypto(self):
        self.assertIn('"LINE"', ATS)
        self.assertIn('"STEAM"', ATS)
        self.assertIn('"FADE"', ATS)
        self.assertIn('"HURT"', ATS)
        self.assertIn('"ICE"', ATS)
        self.assertIn('"CLOCK"', ATS)
        self.assertIn('"FORM"', ATS)
        self.assertIn('"WX"', ATS)
        self.assertIn("parent", ATS)
        for crypto in ("WICK", "PULSE", "DRIFT", "TAPE", "CARRY", "ORBIT", "KXBTCD", "UP / DOWN"):
            self.assertNotIn(f'"{crypto}"', ATS.split("SEATS:", 1)[1].split("CHAIR:", 1)[0])
        self.assertIn("LINE", HTML + JS)
        self.assertIn("STEAM", HTML + JS)
        self.assertIn("HURT", HTML + JS)

    def test_no_follower_and_paper_only(self):
        self.assertNotIn("desk_ats", FOLLOWER)
        self.assertNotIn("desk_ats", LEADER)
        self.assertIn("paper_only", ATS)
        self.assertIn('"follower": False', ATS)
        self.assertIn("Never talks to Follower", ATS + HTML)
        self.assertNotIn("/api/follower/order", JS)
        self.assertIn('@app.get("/api/ats")', MAIN)
        self.assertGreater(MAIN.find("api_unknown"), MAIN.find("/api/ats"))

    def test_calls_are_sports_not_crypto(self):
        self.assertIn("COVER", ATS)
        self.assertIn("NO-COVER", ATS)
        self.assertIn("OVER", ATS)
        self.assertIn("UNDER", ATS)
        self.assertIn("Never UP / DOWN / YES / NO", ATS)
        self.assertIn('return "WAIT"', ATS)


class AtsPickTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        desk_ats.reset_for_tests(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_verified_series_and_404_drop(self):
        ticks = [s for _sp, s, _k in desk_ats.V1_SERIES]
        self.assertIn("KXNFLGAME", ticks)
        self.assertIn("KXNFLSPREAD", ticks)
        self.assertIn("KXNFLTOTAL", ticks)
        self.assertIn("KXNCAAFGAME", ticks)
        self.assertIn("KXNCAAFSPREAD", ticks)
        self.assertIn("KXNCAAFTOTAL", ticks)
        self.assertNotIn("KXCFB", ticks)
        self.assertNotIn("KXNFL", ticks)
        self.assertNotIn("KXBTCD", ticks)

    async def test_404_series_is_dropped(self):
        board = await desk_ats.build_board(
            fetch=_fetch_factory({"KXNFLSPREAD": "404", "KXNFLTOTAL": "404"}),
            now=NOW,
            force=True,
        )
        self.assertIn("KXNFLSPREAD", board["dead_series"])
        self.assertNotIn("KXNFLSPREAD", board["series"])

    async def test_keeps_20_80_with_depth_and_picks_one_game(self):
        board = await desk_ats.build_board(fetch=_fetch_factory(), now=NOW, force=True)
        pick = board["pick"]
        self.assertIsNotNone(pick)
        self.assertEqual(pick["game"], "DALSEA")
        self.assertIn(pick["kind"], ("ml", "spread", "total"))
        self.assertTrue(20 <= float(pick["mid"]) <= 80)
        kinds = {s["kind"] for s in pick["siblings"]}
        self.assertTrue(kinds <= {"ml", "spread", "total"})

    async def test_chalk_99_is_ice_not_a_lock(self):
        extra = {
            "nfl_ml": [
                _m("KXNFLGAME-26AUG15DALSEA-SEA", event="KXNFLGAME-26AUG15DALSEA",
                   yes_bid="0.98", yes_ask="0.99", volume="90000"),
            ],
            "nfl_spread": [],
            "nfl_total": [],
        }
        rows = await desk_ats.scan_open(fetch=_fetch_factory(extra))
        self.assertTrue(rows)
        self.assertTrue(all(r.get("ice") for r in rows))
        board = await desk_ats.build_board(fetch=_fetch_factory(extra), now=NOW, force=True)
        self.assertEqual(board["chair"]["eye"], "WAIT")
        self.assertTrue(board["paper_only"])
        self.assertFalse(board["follower"])

    def test_unknown_book_is_not_dead(self):
        m = _m("KXNFLGAME-26AUG15DALSEA-SEA", volume=None, oi=None)
        m.pop("volume_fp")
        m.pop("open_interest_fp")
        depth = desk_ats.measured_depth(m)
        self.assertTrue(desk_ats.book_is_unknown(depth) or depth["book_state"] == "unknown")
        quotes = desk_ats.market_quotes(m)
        why = desk_ats.ice_reason(quotes, depth)
        self.assertIsNone(why)
        empty = desk_ats.measured_depth(_m("KXNFLGAME-26AUG15DALSEA-SEA", volume="0", oi="0"))
        self.assertEqual(empty["book_state"], "dead")
        self.assertIn("EMPTY", desk_ats.ice_reason(quotes, empty) or "")

    def test_sports_calls_never_crypto(self):
        self.assertEqual(desk_ats.sports_call("total", "YES", None, "DAL", "SEA"), "OVER")
        self.assertEqual(desk_ats.sports_call("total", "NO", None, "DAL", "SEA"), "UNDER")
        self.assertEqual(desk_ats.sports_call("spread", "YES", "SEA", "SEA", "DAL"), "COVER")
        self.assertEqual(desk_ats.sports_call("spread", "NO", "SEA", "SEA", "DAL"), "NO-COVER")
        self.assertEqual(desk_ats.sports_call("ml", "YES", "SEA", "SEA", "DAL"), "SEA")
        for bad in ("UP", "DOWN", "YES", "NO"):
            self.assertNotEqual(desk_ats.sports_call("ml", "YES", "SEA", "SEA", "DAL"), bad)

    def test_eyes_recolor_from_pick(self):
        wait = desk_ats.eye_from_pick("WAIT")
        self.assertEqual(wait["mode"], "wait")
        over = desk_ats.eye_from_pick("OVER", "total")
        self.assertEqual(over["primary"], desk_ats.HEAT)
        under = desk_ats.eye_from_pick("UNDER", "total")
        self.assertEqual(under["primary"], desk_ats.ICE_CYAN)
        sea = desk_ats.eye_from_pick("SEA", "ml", "SEA")
        self.assertEqual(sea["primary"], desk_ats.TEAM_COLORS["SEA"][0])
        unk = desk_ats.eye_from_pick("ZZZ", "ml", "ZZZ")
        self.assertEqual(unk["primary"], desk_ats.GOLD)
        self.assertEqual(unk["secondary"], desk_ats.CYAN)

    def test_calendar_prefers_cfb_saturday_when_liquid(self):
        pri = desk_ats.sport_priority(datetime(2026, 8, 15, 16, 0, tzinfo=timezone.utc))
        self.assertEqual(pri[0], "CFB")
        sun = desk_ats.sport_priority(datetime(2026, 8, 16, 16, 0, tzinfo=timezone.utc))
        self.assertEqual(sun[0], "NFL")

    async def test_paper_lock_caps_and_follower_off(self):
        board = await desk_ats.build_board(fetch=_fetch_factory(), now=NOW, force=True)
        self.assertTrue(board["paper_only"])
        self.assertFalse(board["follower"])
        self.assertFalse(board["live"])
        self.assertEqual(board["leader"], "ARES")
        if board["pick"] and not board["pick"].get("ice"):
            self.assertTrue(any(str(r.get("side") or "") != "WAIT" for r in board["tape"]) or board["chair"]["eye"] == "WAIT")
        for _ in range(8):
            desk_ats.paper_lock_if_clear({
                "ice": None, "call": "COVER", "leftover": 4.0, "game": f"X{_}",
                "ticker": f"T{_}", "sport": "NFL", "kind": "spread",
                "mid": 46, "title": "x", "number": "SEA -6.5", "close_time": "2026-08-16T00:00:00Z",
                "side": "YES",
            }, now=NOW)
        self.assertLessEqual(desk_ats.locks_today(NOW), 5)

    def test_no_zt_in_ats_identity(self):
        self.assertNotIn("ZT", desk_ats.CHAIR["name"])
        self.assertNotIn("ZT", desk_ats.CHAIR["job"])
        self.assertEqual(desk_ats.CHAIR["name"], "ARES")

    def test_watch_never_invents_a_channel(self):
        dark = desk_ats.dark_watch("NO LISTING")
        self.assertEqual(dark["line"], "WATCH · DARK · NO LISTING")
        self.assertFalse(dark["listed"])
        self.assertIsNone(dark["network"])
        self.assertEqual(desk_ats.dark_watch("NO GAME")["line"], "WATCH · DARK · NO GAME ON THE TABLE")
        self.assertEqual(desk_ats.dark_watch("FEED QUIET", down=True)["line"], "WATCH · DARK · FEED QUIET")
        self.assertIsNone(desk_ats.match_watch_event([], "DAL", "SEA"))
        self.assertIsNone(desk_ats.match_watch_event([{"shortName": "DAL @ SEA", "competitors": [
            {"abbreviation": "DAL"}, {"abbreviation": "SEA"},
        ], "broadcasts": []}], "ZZZ", "QQQ"))
        listed = desk_ats.listing_from_event({
            "shortName": "CLE @ CHI",
            "broadcast": "NFL Net",
            "broadcasts": [
                {"type": "TV", "isNational": True, "shortName": "NFL Net", "name": "NFL Network"},
                {"type": "TV", "isNational": False, "shortName": "FOX32", "name": "FOX32"},
            ],
        })
        self.assertTrue(listed["listed"])
        self.assertEqual(listed["network"], "NFL Net")
        self.assertEqual(listed["line"], "WATCH · NFL Net · NATIONAL")
        self.assertNotIn("ESPN", listed["line"])
        empty = desk_ats.listing_from_event({"shortName": "MIN @ NYG", "broadcasts": []})
        self.assertFalse(empty["listed"])
        self.assertIn("DARK", empty["line"])
        ev = {
            "shortName": "DAL @ SEA",
            "competitors": [{"abbreviation": "DAL"}, {"abbreviation": "SEA"}],
            "broadcasts": [{"type": "TV", "isNational": True, "shortName": "FOX", "name": "FOX"}],
        }
        self.assertEqual(desk_ats.match_watch_event([ev], "SEA", "DAL")["shortName"], "DAL @ SEA")
        self.assertEqual(desk_ats.watch_copy(["ESPN"], "national"), "WATCH · ESPN · NATIONAL")
        self.assertEqual(desk_ats.watch_copy(["Prime"], "stream"), "WATCH · Prime · STREAM")
        self.assertEqual(desk_ats.watch_copy(["WIVB", "WSOC"], "local"), "WATCH · WIVB / WSOC · LOCAL")

    async def test_watch_attaches_to_pick_and_fails_soft(self):
        events = [{
            "shortName": "DAL @ SEA",
            "competitors": [{"abbreviation": "DAL"}, {"abbreviation": "SEA"}],
            "broadcasts": [{"type": "TV", "isNational": True, "shortName": "CBS", "name": "CBS"}],
        }]
        board = await desk_ats.build_board(fetch=_fetch_factory(), now=NOW, force=True, watch_events=events)
        self.assertIn("watch", board)
        self.assertEqual(board["watch"]["source"], "espn-header")
        if board.get("pick") and board["pick"].get("home") in ("DAL", "SEA"):
            self.assertTrue(board["watch"]["listed"])
            self.assertEqual(board["watch"]["network"], "CBS")
            self.assertIn("CBS", board["watch"]["line"])
        quiet = await desk_ats.attach_watch({"home": "DAL", "away": "SEA", "sport": "NFL"}, events=[])
        self.assertFalse(quiet["listed"])
        self.assertIn("DARK", quiet["line"])
        async def boom(path, params):
            raise RuntimeError("espn down")
        desk_ats._watch_cache.clear()
        down = await desk_ats.attach_watch({"home": "DAL", "away": "SEA", "sport": "NFL"}, fetch=boom)
        self.assertTrue(down["down"])
        self.assertEqual(down["line"], "WATCH · DARK · FEED QUIET")
        self.assertNotIn("ESPN", down["line"])


class AtsFloorChromeTests(unittest.TestCase):
    def test_four_equal_floor_chairs(self):
        self.assertIn("function drawQuadFloor", JS)
        self.assertIn("function quadFloorTableR", JS)
        self.assertIn('drawTableWithBots(', JS)
        self.assertIn('"ats"', JS)
        self.assertIn("function isAtsTable", JS)
        self.assertIn('setFocusTable("ats")', JS)
        self.assertIn('bind(focusAts, "ats")', JS)
        geo = JS[JS.find("function floorHudGeometry"): JS.find("window.__floorHudGeometry")]
        self.assertIn("ARES", geo)
        self.assertIn("RAIJIN", geo)
        self.assertIn("SATOSHI", geo)
        self.assertIn("VITALIK", geo)
        self.assertIn("function floorHudGeometry", JS)

    def test_watch_line_on_ats_hud(self):
        self.assertIn('id="atsWatch"', HTML)
        self.assertIn("function paintAtsWatch", JS)
        self.assertIn("WATCH · DARK", HTML + JS + ATS)
        self.assertIn("espn-header", ATS)
        self.assertIn("Never invent a channel", ATS)
        self.assertNotIn('"WATCH"', ATS.split("SEATS:", 1)[1].split("CHAIR:", 1)[0])

    def test_eyes_are_css_mask_not_32_faces(self):
        self.assertIn("ares-eye", CSS)
        self.assertIn("ares-face", CSS + HTML)
        self.assertIn("--ares-eye-a", CSS + JS)
        self.assertNotIn("ares-kc.jpg", JS + HTML)
        self.assertNotIn("ares-dal.jpg", JS + HTML)

    def test_front_weather_seats_not_stripped(self):
        self.assertIn("GLASS", HTML)
        self.assertIn("PIT", HTML)
        self.assertIn("FROST", HTML)
        self.assertIn("BONE", HTML)
        self.assertIn("KXHIGHTDAL", HTML + JS)


# unittest async helpers
def _as_sync(fn):
    import asyncio

    def wrap(self):
        return asyncio.run(fn(self))
    return wrap


for _name, _fn in list(AtsPickTests.__dict__.items()):
    if _name.startswith("test_") and _fn.__class__.__name__ == "function":
        if "async" in str(_fn):
            pass

import inspect
import asyncio

def _bind_async_tests(cls):
    for name, fn in list(cls.__dict__.items()):
        if name.startswith("test_") and inspect.iscoroutinefunction(fn):
            setattr(cls, name, (lambda f: (lambda self: asyncio.run(f(self))))(fn))

_bind_async_tests(AtsPickTests)
