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
        self.assertIn("focusOra", row)
        self.assertIn(">DWF</button>", row)
        self.assertIn(">ATS</button>", row)
        self.assertIn(">ORA</button>", row)
        self.assertNotIn(">GLD</button>", row)
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
        self.assertIn("/static/ares-wait.png", HTML + JS + ATS)
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

    def test_prefers_nearer_kick_over_month_out_cfb(self):
        """Sep 18 HOU@TTU cannot beat a nearer NFL or CFB book — leftover is not a month jump."""
        far = {
            "ticker": "KXNCAAFGAME-26SEP18HOUTTU-HOU",
            "game": "HOUTTU",
            "sport": "CFB",
            "kind": "ml",
            "call": "HOU",
            "leftover": 12.0,
            "ice": None,
            "close_time": "2026-09-18T23:59:00Z",
            "unknown_book": False,
        }
        near_nfl = {
            "ticker": "KXNFLGAME-26AUG15DALSEA-SEA",
            "game": "DALSEA",
            "sport": "NFL",
            "kind": "ml",
            "call": "SEA",
            "leftover": 3.0,
            "ice": None,
            "close_time": "2026-08-16T00:00:00Z",
            "unknown_book": False,
        }
        near_cfb = {
            "ticker": "KXNCAAFGAME-26AUG16OSUMICH-OSU",
            "game": "OSUMICH",
            "sport": "CFB",
            "kind": "ml",
            "call": "OSU",
            "leftover": 2.0,
            "ice": None,
            "close_time": "2026-08-16T19:00:00Z",
            "unknown_book": False,
        }
        haw = {
            "ticker": "KXNCAAFGAME-26AUG22HAWSTAN-HAW",
            "game": "HAWSTAN",
            "sport": "CFB",
            "kind": "ml",
            "call": "HAW",
            "leftover": 9.0,
            "ice": None,
            "close_time": "2026-08-22T12:00:00Z",
            "unknown_book": False,
        }
        mid = {
            "ticker": "KXNFLGAME-26AUG17KCNY-KC",
            "game": "KCNY",
            "sport": "NFL",
            "kind": "ml",
            "call": "KC",
            "leftover": 11.0,
            "ice": None,
            "close_time": "2026-08-17T20:00:00Z",
            "unknown_book": False,
        }
        self.assertGreater(desk_ats.kick_mins_left(far, NOW), desk_ats.MONTH_KICK_MINS)
        self.assertGreater(desk_ats.kick_mins_left(far, NOW), desk_ats.MAX_KICK_MINS)
        self.assertGreater(desk_ats.kick_mins_left(haw, NOW), desk_ats.MAX_KICK_MINS)
        self.assertLessEqual(desk_ats.kick_mins_left(near_nfl, NOW), desk_ats.NEAR_KICK_MINS)
        self.assertLessEqual(desk_ats.kick_mins_left(near_cfb, NOW), desk_ats.NEAR_KICK_MINS)
        self.assertTrue(desk_ats.playable_kick(mid, NOW))
        self.assertGreater(desk_ats.kick_mins_left(mid, NOW), desk_ats.NEAR_KICK_MINS)
        self.assertEqual(desk_ats.pick_one_game([far, near_nfl], now=NOW)["game"], "DALSEA")
        self.assertEqual(desk_ats.pick_one_game([far, near_cfb], now=NOW)["game"], "OSUMICH")
        self.assertEqual(desk_ats.pick_one_game([far, haw, near_nfl], now=NOW)["game"], "DALSEA")
        # Week-out HAW and month-out HOU are both past the 72h cap → WAIT.
        self.assertIsNone(desk_ats.pick_one_game([far, haw], now=NOW))
        self.assertIsNone(desk_ats.pick_one_game([far], now=NOW))
        # Same-day / <24h football still wins inside the window over a 48h leftover.
        self.assertEqual(desk_ats.pick_one_game([mid, near_nfl], now=NOW)["game"], "DALSEA")
        self.assertEqual(desk_ats.pick_one_game([mid, near_cfb], now=NOW)["game"], "OSUMICH")
        self.assertEqual(desk_ats.pick_one_game([mid], now=NOW)["game"], "KCNY")
        # Calendar still breaks ties among similarly-near books (Saturday → CFB).
        sat_nfl = dict(near_nfl, leftover=8.0)
        sat_cfb = dict(near_cfb, leftover=4.0)
        self.assertEqual(desk_ats.pick_one_game([sat_nfl, sat_cfb], now=NOW)["game"], "OSUMICH")

    def test_month_out_only_leftover_is_wait(self):
        """Sep 18 HOU@TTU is not picked even when it is the only leftover."""
        far = {
            "ticker": "KXNCAAFGAME-26SEP18HOUTTU-HOU",
            "game": "HOUTTU",
            "sport": "CFB",
            "kind": "ml",
            "call": "HOU",
            "leftover": 18.0,
            "ice": None,
            "close_time": "2026-09-21T00:00:00Z",
            "unknown_book": False,
        }
        self.assertTrue(desk_ats.beyond_kick_cap(far, NOW))
        self.assertIsNone(desk_ats.pick_one_game([far], now=NOW))
        locked = dict(far)
        self.assertIsNone(desk_ats.paper_lock_if_clear(locked, now=NOW))
        self.assertEqual(locked["call"], "WAIT")
        self.assertIn("72H", locked.get("gate") or "")

    async def test_board_skips_sep18_cfb_when_nearer_nfl_exists(self):
        extra = {
            "KXNCAAFGAME": [
                _m(
                    "KXNCAAFGAME-26SEP18HOUTTU-HOU",
                    series="KXNCAAFGAME",
                    event="KXNCAAFGAME-26SEP18HOUTTU",
                    title="Will Houston win the Houston vs Texas Tech game?",
                    yes_bid="0.38",
                    yes_ask="0.40",
                    volume="88000",
                    close="2026-09-18T23:59:00Z",
                ),
            ],
            "KXNCAAFSPREAD": [],
            "KXNCAAFTOTAL": [],
        }
        board = await desk_ats.build_board(fetch=_fetch_factory(extra), now=NOW, force=True)
        pick = board["pick"]
        self.assertIsNotNone(pick)
        self.assertNotEqual(pick["game"], "HOUTTU")
        self.assertNotIn("HOUTTU", str(pick.get("ticker") or ""))
        self.assertEqual(pick["game"], "DALSEA")
        self.assertEqual(pick["sport"], "NFL")

    async def test_board_waits_when_only_sep18_leftover(self):
        extra = {
            "KXNFLGAME": [],
            "KXNFLSPREAD": [],
            "KXNFLTOTAL": [],
            "KXNCAAFGAME": [
                _m(
                    "KXNCAAFGAME-26SEP18HOUTTU-HOU",
                    series="KXNCAAFGAME",
                    event="KXNCAAFGAME-26SEP18HOUTTU",
                    title="Will Houston win the Houston vs Texas Tech game?",
                    yes_bid="0.38",
                    yes_ask="0.40",
                    volume="88000",
                    close="2026-09-21T00:00:00Z",
                ),
            ],
            "KXNCAAFSPREAD": [],
            "KXNCAAFTOTAL": [],
        }
        board = await desk_ats.build_board(fetch=_fetch_factory(extra), now=NOW, force=True)
        pick = board["pick"]
        self.assertTrue(board.get("candidates"), "Hunter must show the next real sports candidate")
        self.assertEqual(board["chair"]["eye"], "WAIT")
        if pick:
            self.assertEqual(pick.get("call"), "WAIT")
        self.assertIsNone((board.get("hunter") or {}).get("side"))
        self.assertTrue(board["paper_only"])
        self.assertFalse(board["follower"])
        self.assertFalse(board["live"])

    async def test_board_sits_morning_sep18_fill_and_picks_nearer(self):
        desk_ats._fills.append({
            "id": "ats-1786814518368",
            "ticker": "KXNCAAFGAME-26SEP18HOUTTU-HOU",
            "game": "HOUTTU",
            "sport": "CFB",
            "kind": "ml",
            "side": "HOU",
            "result": "OPEN",
            "settled": False,
            "paper": True,
            "follower": False,
            "close_time": "2026-09-21T00:00:00Z",
            "day": "2026-08-15",
        })
        desk_ats._save_fills()
        board = await desk_ats.build_board(fetch=_fetch_factory(), now=NOW, force=True)
        pick = board["pick"]
        self.assertIsNotNone(pick)
        self.assertEqual(pick["game"], "DALSEA")
        self.assertNotEqual(pick.get("call"), "HOU")
        stored = next(r for r in desk_ats._load_fills() if r.get("id") == "ats-1786814518368")
        self.assertIn(str(stored.get("result") or "").upper(), ("SIT", "VOID"))
        self.assertTrue(board["paper_only"])
        self.assertFalse(board["follower"])

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

    def test_why_uses_real_facts_and_sits_when_dark(self):
        why0 = desk_ats.build_why(None, [], [])
        self.assertIn("DARK", why0["line"])
        self.assertIn("HURT DARK", why0["strip"])
        self.assertFalse(any(r["fed"] for r in why0["seats"] if r["id"] == "HURT"))
        self.assertIsNone(desk_ats.parse_hurt({}))
        self.assertIsNone(desk_ats.parse_form({"againstTheSpread": [{"team": {"abbreviation": "CHI"}, "records": []}], "lastFiveGames": []}))
        self.assertIsNone(desk_ats.parse_hurt({"injuries": [{"team": {"abbreviation": "CHI"}, "injuries": [{"status": "Active", "athlete": {"displayName": "Nobody"}}]}]}))
        hurt = desk_ats.parse_hurt({"injuries": [{"team": {"abbreviation": "CHI"}, "injuries": [
            {"status": "Out", "athlete": {"shortName": "O. Trapilo"}, "type": {"description": "out"}},
            {"status": "Questionable", "athlete": {"shortName": "C. Bryant"}},
        ]}]})
        self.assertEqual(hurt, "CHI OUT O. Trapilo")
        self.assertNotIn("Bryant", hurt or "")
        form = desk_ats.parse_form({"lastFiveGames": [{"team": {"abbreviation": "CHI"}, "events": [
            {"gameResult": "W"}, {"gameResult": "L"}, {"gameResult": "W"},
        ]}]})
        self.assertEqual(form, "CHI L5 2-1")
        wx, mattered = desk_ats.parse_wx({"gameInfo": {"weather": {"temperature": 75, "conditionId": "Cloudy", "precipitation": 80, "gust": 5}}})
        self.assertIn("75°", wx)
        self.assertTrue(mattered)
        fair, fair_m = desk_ats.parse_wx({"gameInfo": {"weather": {"temperature": 72, "conditionId": "Clear", "precipitation": 0}}})
        self.assertFalse(fair_m)
        pick = {
            "call": "DAL", "kind": "ml", "number": "DAL @ SEA", "mid": 41, "leftover": 7.8,
            "public": "SEA", "steam": 0.0, "ice": None, "hurt": "CHI OUT O. Trapilo",
            "form": "CHI L5 2-1", "wx": "75° CLOUDY 80% RAIN", "wx_mattered": True,
            "close_time": "2026-08-16T00:00:00Z",
        }
        seats = desk_ats.build_seats(pick)
        subs = desk_ats.build_subs(pick)
        why = desk_ats.build_why(pick, seats, subs)
        self.assertIn("WHY · DAL", why["line"])
        self.assertIn("FADE SEA", why["line"])
        self.assertIn("LEFTOVER", why["line"])
        self.assertIn("Trapilo", why["line"])
        ids = [r["id"] for r in why["seats"]]
        self.assertEqual(ids[:5], ["LINE", "STEAM", "FADE", "HURT", "ICE"])
        hurt_row = next(r for r in why["seats"] if r["id"] == "HURT")
        self.assertEqual(hurt_row["vote"], "WAIT")
        self.assertTrue(hurt_row["fed"])
        self.assertIn("Trapilo", hurt_row["fact"])
        steam_row = next(r for r in why["seats"] if r["id"] == "STEAM")
        self.assertIn("SIT", steam_row["fact"])
        self.assertIn("HURT CHI OUT O. Trapilo", why["strip"])
        self.assertIn("FORM CHI L5 2-1", why["strip"])
        self.assertIn("WX 75°", why["strip"])
        self.assertIn("STEAM SIT", why["strip"])
        self.assertIn("LINE DAL", why["strip"])

    async def test_why_attaches_on_board(self):
        summary = {
            "injuries": [{"team": {"abbreviation": "SEA"}, "injuries": [
                {"status": "Out", "athlete": {"shortName": "D. Metcalf"}, "type": {"description": "out"}},
            ]}],
            "lastFiveGames": [{"team": {"abbreviation": "SEA"}, "events": [{"gameResult": "W"}, {"gameResult": "W"}]}],
            "gameInfo": {"weather": {"temperature": 64, "conditionId": "Clear", "precipitation": 10}},
        }
        events = [{
            "id": "4018",
            "shortName": "DAL @ SEA",
            "competitors": [{"abbreviation": "DAL"}, {"abbreviation": "SEA"}],
            "broadcasts": [{"type": "TV", "isNational": True, "shortName": "FOX"}],
        }]
        board = await desk_ats.build_board(
            fetch=_fetch_factory(), now=NOW, force=True, watch_events=events, espn_summary=summary,
        )
        self.assertIn("why", board)
        self.assertEqual(board["why"]["source"], "kalshi+espn-summary")
        if board.get("pick"):
            self.assertIn("Metcalf", board["pick"].get("hurt") or "")
            self.assertIn("SEA L5", board["pick"].get("form") or "")
            self.assertIn("64°", board["pick"].get("wx") or "")
            self.assertIn("Metcalf", board["why"]["strip"])
            self.assertIn("FORM SEA L5", board["why"]["strip"])
            self.assertNotIn("WX", board["why"]["strip"])  # clear 64° did not matter


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

    def test_why_strip_on_ats_hud(self):
        self.assertIn('id="atsWhy"', HTML)
        self.assertIn('id="atsWhyStrip"', HTML)
        self.assertIn("function paintAtsWhy", JS)
        self.assertIn("WHY · DARK", HTML + JS + ATS)
        self.assertIn("SIT · DARK", ATS)
        self.assertIn("kalshi+espn-summary", ATS)
        self.assertNotIn('"WHY"', ATS.split("SEATS:", 1)[1].split("CHAIR:", 1)[0])

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

    def test_one_ares_portrait_not_stacked(self):
        paint = JS.split("function paintAresEyes", 1)[1].split("function drawAresEyeTint", 1)[0]
        self.assertIn("face.hidden = true", paint)
        self.assertNotIn("face.hidden = !show", paint)
        self.assertIn("Never unhide the HTML overlay", paint)
        self.assertIn("function drawAresEyeTint", JS)
        self.assertIn('aresPortrait.src = "/static/ares-wait.png"', JS)
        self.assertIn("containPortrait(img", JS)
        face_css = CSS[CSS.find(".ares-face"): CSS.find(".ats-sub")]
        self.assertIn("display: none !important", face_css)

    def test_ats_rehomed_from_main(self):
        self.assertIn('id="focusAts"', HTML)
        self.assertIn('id="aresFace"', HTML)
        self.assertIn("function atsTableState", JS)
        self.assertIn('fetch("/api/ats"', JS)
        self.assertIn("@app.get(\"/api/ats\")", MAIN)
        self.assertIn("LINE", ATS)
        self.assertIn("STEAM", ATS)
        self.assertIn("FADE", ATS)
        self.assertIn("HURT", ATS)
        self.assertIn("ICE", ATS)
        self.assertIn("function paintAtsWatch", JS)
        self.assertIn("function paintAtsWhy", JS)
        for name in ("ONE TICKET", "KEY NUMBERS", "SIT AFTER KICK", "SPORT BRAINS", "PUBLIC TUG"):
            self.assertIn(name, ATS)

    def test_ats_window_is_game_kick_not_1h(self):
        self.assertIn("def build_game_clock", ATS)
        self.assertIn('"kind": "game"', ATS)
        self.assertIn("seconds_to_kick", ATS)
        self.assertIn("function atsKickLine", JS)
        chrome = JS.split("function paintFrontWindowChrome", 1)[1].split("function dockWindowLed", 1)[0]
        self.assertIn('ledLabel.textContent = "CLOCK"', chrome)
        self.assertIn("atsKickLine", chrome)
        self.assertIn("THEY'RE OFF", JS)
        self.assertIn("CLOCK IS DARK", JS)
        self.assertIn("KICK IN", JS)
        self.assertIn("dualSub.hidden = !!ats", chrome)
        self.assertNotIn("3600", chrome)
        self.assertIn("window_kind: \"game\"", JS)
        pair = JS.split("function drawPairCandles", 1)[1].split("function drawChartBtc()", 1)[0]
        self.assertIn("isAtsTable(focusTable)", pair)
        self.assertIn('setPairWindowChip(canvas, "")', pair)
        clock = desk_ats.build_game_clock(
            {"close_time": "2026-08-16T00:00:00Z", "game": "DAL SEA", "number": "SEA -6.5"},
            now=NOW,
        )
        self.assertEqual(clock["kind"], "game")
        self.assertEqual(clock["label"], "KICK")
        self.assertGreater(clock["seconds_to_kick"], 0)
        self.assertNotIn("1H", clock["label"])
        self.assertIn("KICK IN", clock["line"])
        self.assertEqual(desk_ats.clock_line("2026-08-16T00:00:00Z", now=NOW), "KICK IN 4H 00M")
        self.assertEqual(desk_ats.clock_line("2026-08-15T18:00:00Z", now=NOW), "THEY'RE OFF")

    def test_ats_bet_chrome_not_crypto(self):
        self.assertIn('id="atsGameStrip"', HTML)
        self.assertIn("function paintAtsGameStrip", JS)
        self.assertIn('GAME <b id="atsGameName"', HTML)
        self.assertIn('LINE <b id="atsGameLine"', HTML)
        self.assertIn('id="atsSportChip"', HTML)
        self.assertIn("ats-sport-chip", HTML + CSS)
        strip = JS.split("function paintAtsGameStrip", 1)[1].split("function paintFrontWindowChrome", 1)[0]
        self.assertIn("pick.sport", strip)
        self.assertIn("clock.sport", strip)
        self.assertIn("atsSportChip", strip)
        self.assertIn("NO BOOK", strip)
        self.assertIn("WAIT", strip)
        self.assertIn("data-live", strip)
        self.assertIn("nameEl.textContent = game", strip)
        self.assertIn("lineEl.textContent = number", strip)
        clock = desk_ats.build_game_clock(
            {"close_time": "2026-08-16T00:00:00Z", "game": "OSU MICH", "number": "OSU -7", "sport": "CFB"},
            now=NOW,
        )
        self.assertEqual(clock["sport"], "CFB")
        self.assertIn("function paintAtsWhy", JS)
        self.assertIn("function paintAtsWatch", JS)
        self.assertIn("body[data-focus-table=\"ats\"] .chart-window-chip", CSS)
        self.assertIn("body[data-focus-table=\"ats\"] .chart-ktarget-chip", CSS)
        self.assertIn('id="dualFightCard"', HTML)
        self.assertIn('id="stripKalshi"', HTML)
        self.assertIn("body[data-focus-table=\"ats\"] #dualFightCard", CSS)
        self.assertIn("body[data-focus-table=\"ats\"] #stripKalshi", CSS)
        self.assertIn("body[data-focus-table=\"ats\"] .window-timer", CSS)
        self.assertIn("chart-crypto-odds", HTML + CSS + JS)
        self.assertIn("chart-crypto-delta", HTML + CSS + JS)
        self.assertIn("chart-crypto-funding", HTML + CSS + JS)
        hud = JS.split("function paintTableHud", 1)[1].split("function collectChairLocks", 1)[0]
        self.assertIn("fightCard.hidden = !!deskBook", hud)
        self.assertIn("if (deskBook) return", hud)
        self.assertNotIn("atsKickLine", hud)

    def test_front_weather_seats_not_stripped(self):
        self.assertIn("GLASS", HTML)
        self.assertIn("PIT", HTML)
        self.assertIn("FROST", HTML)
        self.assertIn("BONE", HTML)
        self.assertIn("KXHIGHTDAL", HTML + JS)

    def test_public_tug_is_floor_visual_only(self):
        self.assertIn("function drawPublicTug", JS)
        self.assertIn("Does not override Chair gates", JS + ATS)
        self.assertIn("visual_only", ATS)
        self.assertNotIn('"TUG"', ATS.split("SEATS:", 1)[1].split("CHAIR:", 1)[0])


class AtsGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        desk_ats.reset_for_tests(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_five_gates_are_in_the_spec(self):
        for name in ("ONE TICKET", "KEY NUMBERS", "SIT AFTER KICK", "SPORT BRAINS", "PUBLIC TUG"):
            self.assertIn(name, desk_ats.ARES_GATES)
            self.assertIn(name, ATS)
            self.assertIn(name, HTML + JS)
        self.assertEqual(len(desk_ats.SEATS), 5)
        self.assertEqual([s["id"] for s in desk_ats.SEATS], ["LINE", "STEAM", "FADE", "HURT", "ICE"])
        self.assertEqual([s["id"] for s in desk_ats.SUBS], ["CLOCK", "FORM", "WX"])
        self.assertEqual(desk_ats.ARES_YES_LO, 20.0)
        self.assertEqual(desk_ats.ARES_YES_HI, 80.0)
        self.assertTrue(desk_ats.ares_playable_mid(50))
        self.assertFalse(desk_ats.ares_playable_mid(12))
        self.assertFalse(desk_ats.ares_playable_mid(91))
        self.assertIn("10–90 is for the crypto Chairs only", ATS)
        self.assertNotIn("WICK", desk_ats.SPORT_BRAINS["NFL"])
        self.assertNotIn("PULSE", desk_ats.SPORT_BRAINS["NBA"])

    def test_one_ticket_picks_one_side_then_sits(self):
        self.assertTrue(desk_ats.is_prop_ticker("KXNFLPLAYER-26AUG15SEA-YDS"))
        self.assertIsNone(desk_ats._normalize_market(
            {**_m("KXNFLPLAYER-26AUG15DALSEA-YDS"), "series_ticker": "KXNFLPLAYER"},
            "KXNFLPLAYER", "ml", "NFL",
        ))
        first = desk_ats.paper_lock_if_clear({
            "ice": None, "call": "COVER", "leftover": 6.0, "game": "DALSEA",
            "ticker": "KXNFLSPREAD-26AUG15DALSEA-SEA7", "sport": "NFL", "kind": "spread",
            "mid": 46, "title": "x", "number": "SEA -6.5", "close_time": "2026-08-16T00:00:00Z",
            "side": "YES",
        }, now=NOW)
        self.assertIsNotNone(first)
        spray = desk_ats.paper_lock_if_clear({
            "ice": None, "call": "OVER", "leftover": 8.0, "game": "KCNY",
            "ticker": "KXNFLTOTAL-26AUG15KCNY-47", "sport": "NFL", "kind": "total",
            "mid": 48, "title": "y", "number": "O/U 47", "close_time": "2026-08-16T00:00:00Z",
            "side": "YES",
        }, now=NOW)
        self.assertIsNone(spray)
        self.assertEqual(desk_ats.locks_today(NOW), 1)
        other = {"ticker": "KXNFLGAME-26AUG15KCNY-KC", "game": "KCNY", "call": "KC", "ice": None}
        self.assertEqual(desk_ats.one_ticket_gate(other, now=NOW), "ONE TICKET · ALREADY SAT")

    def test_open_far_fill_is_sat_and_does_not_block_nearer(self):
        """Morning Sep 18 OPEN fill cannot pin the chair. Sit it; take a nearer book."""
        far_fill = {
            "id": "ats-1786814518368",
            "ticker": "KXNCAAFGAME-26SEP18HOUTTU-HOU",
            "game": "HOUTTU",
            "sport": "CFB",
            "kind": "ml",
            "side": "HOU",
            "yes_no": "YES",
            "result": "OPEN",
            "settled": False,
            "paper": True,
            "follower": False,
            "live": False,
            "close_time": "2026-09-21T00:00:00Z",
            "day": "2026-08-15",
            "at": "2026-08-15T12:00:00+00:00",
        }
        desk_ats._fills.append(far_fill)
        desk_ats._save_fills()
        self.assertIsNone(desk_ats.open_paper_ticket(NOW))
        stored = desk_ats._load_fills()[0]
        self.assertIn(str(stored.get("result") or "").upper(), ("SIT", "VOID"))
        self.assertIn("72H", str(stored.get("sit_reason") or stored.get("result") or ""))
        near = {
            "ice": None, "call": "SEA", "leftover": 6.0, "game": "DALSEA",
            "ticker": "KXNFLGAME-26AUG15DALSEA-SEA", "sport": "NFL", "kind": "ml",
            "mid": 58, "title": "x", "number": "SEA", "close_time": "2026-08-16T00:00:00Z",
            "side": "YES",
        }
        self.assertIsNone(desk_ats.one_ticket_gate(near, held=dict(far_fill), now=NOW))
        lock = desk_ats.paper_lock_if_clear(near, now=NOW)
        self.assertIsNotNone(lock)
        self.assertEqual(lock["game"], "DALSEA")
        self.assertEqual(lock["result"], "OPEN")
        self.assertIsNone(desk_ats.one_ticket_gate(near, now=NOW))

    def test_same_day_football_still_wins_inside_72h(self):
        nfl = {
            "ticker": "KXNFLGAME-26AUG15DALSEA-SEA",
            "game": "DALSEA",
            "sport": "NFL",
            "kind": "ml",
            "call": "SEA",
            "leftover": 3.0,
            "ice": None,
            "close_time": "2026-08-16T00:00:00Z",
            "unknown_book": False,
        }
        cfb = {
            "ticker": "KXNCAAFGAME-26AUG16OSUMICH-OSU",
            "game": "OSUMICH",
            "sport": "CFB",
            "kind": "ml",
            "call": "OSU",
            "leftover": 2.0,
            "ice": None,
            "close_time": "2026-08-16T08:00:00Z",
            "unknown_book": False,
        }
        later = {
            "ticker": "KXNFLGAME-26AUG17KCNY-KC",
            "game": "KCNY",
            "sport": "NFL",
            "kind": "ml",
            "call": "KC",
            "leftover": 14.0,
            "ice": None,
            "close_time": "2026-08-17T20:00:00Z",
            "unknown_book": False,
        }
        self.assertLessEqual(desk_ats.kick_mins_left(nfl, NOW), desk_ats.NEAR_KICK_MINS)
        self.assertLessEqual(desk_ats.kick_mins_left(cfb, NOW), desk_ats.NEAR_KICK_MINS)
        self.assertEqual(desk_ats.pick_one_game([later, nfl], now=NOW)["game"], "DALSEA")
        self.assertEqual(desk_ats.pick_one_game([later, cfb], now=NOW)["game"], "OSUMICH")
        self.assertEqual(desk_ats.pick_one_game([nfl, cfb], now=NOW)["game"], "OSUMICH")
        lock = desk_ats.paper_lock_if_clear(dict(nfl, mid=58, side="YES", title="x", number="SEA"), now=NOW)
        self.assertIsNotNone(lock)
        self.assertEqual(lock["sport"], "NFL")

    def test_btc_shadow_and_eth_gates_untouched(self):
        from backend.agents.chair_gates import (
            btc_shadow_pick,
            eth_paper_lock_blocked,
            eth_shadow_pick,
            is_btc_shadow_row,
            is_eth_shadow_row,
        )
        self.assertEqual(desk_ats.ARES_YES_LO, 20.0)
        self.assertEqual(desk_ats.ARES_YES_HI, 80.0)
        self.assertEqual(desk_ats.EARLY_NO_LOCK_MINS, 8.0)
        self.assertIn("10–90 is for the crypto Chairs only", ATS)
        self.assertIn("function atsKickLine", JS)
        self.assertIn("function paintAresEyes", JS)
        self.assertIn('id="aresFace"', HTML)
        self.assertIn('id="atsSportChip"', HTML)
        self.assertIn('"follower": False', ATS)
        self.assertIn("paper_only", ATS)
        self.assertIn("def btc_shadow_pick", GATES)
        self.assertIn("def eth_shadow_pick", GATES)
        self.assertIn("def eth_paper_lock_blocked", GATES)
        self.assertNotIn("btc_shadow", ATS)
        self.assertNotIn("eth_shadow", ATS)
        self.assertIsNotNone(eth_paper_lock_blocked("ETH", 0))
        self.assertIsNotNone(eth_paper_lock_blocked("ETH", 7))
        self.assertIsNone(eth_paper_lock_blocked("ETH", 8))
        btc = btc_shadow_pick("BTC", "UP", 80, ask=50, strike=63000)
        self.assertEqual(btc["kind"], "btc_shadow")
        self.assertTrue(is_btc_shadow_row(btc))
        self.assertFalse(is_eth_shadow_row(btc))
        self.assertIsNone(btc_shadow_pick("ETH", "UP", 80))
        eth = eth_shadow_pick("ETH", "DOWN", 71, ask=44, strike=1874.99)
        self.assertTrue(is_eth_shadow_row(eth))
        self.assertFalse(is_btc_shadow_row(eth))

    def test_key_numbers_football_gate_nba_noop(self):
        thin = {
            "sport": "NFL", "kind": "spread", "floor_strike": 3.0, "side": "YES",
            "call": "COVER", "leftover": 0.4, "quotes": {"yes_ask": 46.0, "no_ask": 56.0},
            "ticker": "KXNFLSPREAD-26AUG15DALSEA-SEA3", "number": "SEA -3",
        }
        self.assertIn("KEY NUMBER", desk_ats.key_number_gate(thin) or "")
        fat = dict(thin, leftover=8.0)
        self.assertIsNone(desk_ats.key_number_gate(fat))
        seven = dict(thin, floor_strike=7.0, leftover=0.2)
        self.assertIn("7", desk_ats.key_number_gate(seven) or "")
        getting = dict(thin, side="NO", call="NO-COVER")
        self.assertIsNone(desk_ats.key_number_gate(getting))
        nba = dict(thin, sport="NBA")
        self.assertIsNone(desk_ats.key_number_gate(nba))
        mlb = dict(thin, sport="MLB")
        self.assertIsNone(desk_ats.key_number_gate(mlb))
        total = dict(thin, kind="total", number="O/U 47")
        self.assertIsNone(desk_ats.key_number_gate(total))

    def test_sit_after_kick_and_late_hurt(self):
        off = desk_ats.sit_after_kick(
            {"close_time": "2026-08-15T18:00:00Z", "status": "active"}, now=NOW,
        )
        self.assertIn("SIT AFTER KICK", off or "")
        live = desk_ats.sit_after_kick({"status": "in_play", "close_time": "2026-08-16T00:00:00Z"}, now=NOW)
        self.assertIn("IN PLAY", live or "")
        espn = desk_ats.sit_after_kick(
            {"close_time": "2026-08-16T00:00:00Z", "status": "active"},
            watch={"live": True, "line": "WATCH · FOX · NATIONAL"},
            now=NOW,
        )
        self.assertIn("LIVE", espn or "")
        self.assertTrue(desk_ats.event_is_live({"status": "in"}))
        self.assertFalse(desk_ats.event_is_live({"status": "pre"}))
        late = desk_ats.late_hurt_gate({
            "hurt": "SEA OUT D. Metcalf",
            "close_time": "2026-08-15T20:10:00Z",
        }, now=NOW)
        self.assertEqual(late, "LATE HURT · SIT")
        early = desk_ats.late_hurt_gate({
            "hurt": "SEA OUT D. Metcalf",
            "close_time": "2026-08-16T00:00:00Z",
        }, now=NOW)
        self.assertIsNone(early)
        iced = {"ice": "99¢ CHALK · ICE ON", "call": "WAIT", "sport": "NFL", "kind": "spread",
                "floor_strike": 3.0, "leftover": 0.2, "side": "YES", "close_time": "2026-08-15T18:00:00Z"}
        why = desk_ats.apply_ares_gates(iced, now=NOW)
        self.assertIn("99¢", why or "")
        self.assertEqual(iced["ice"], "99¢ CHALK · ICE ON")
        self.assertIsNone(iced.get("gate"))

    def test_sport_brains_are_not_crypto(self):
        nfl = desk_ats.sport_brain("NFL")
        nba = desk_ats.sport_brain("NBA")
        mlb = desk_ats.sport_brain("MLB")
        self.assertNotEqual(nfl["FADE"], nba["FADE"])
        self.assertNotEqual(nfl["STEAM"], mlb["STEAM"])
        self.assertGreater(nfl["FADE"], nba["FADE"])
        tue = desk_ats.sport_priority(datetime(2026, 8, 18, 16, 0, tzinfo=timezone.utc))
        self.assertIn(tue[0], ("MLB", "NBA", "NHL"))
        self.assertNotEqual(tue[0], "NFL")
        for crypto in ("WICK", "PULSE", "DRIFT", "TAPE", "CARRY", "ORBIT"):
            self.assertNotIn(crypto, nfl)
            self.assertNotIn(crypto, nba)
        seats = desk_ats.build_seats({
            "call": "DAL", "sport": "NFL", "number": "DAL @ SEA", "mid": 41,
            "public": "SEA", "steam": 0.0, "ice": None,
        })
        fade = next(s for s in seats if s["id"] == "FADE")
        self.assertEqual(fade["weight"], nfl["FADE"])

    def test_public_tug_does_not_override_gates(self):
        pick = {
            "call": "DAL", "public": "SEA", "steam": 3.0, "mid": 41,
            "sport": "NFL", "kind": "ml", "ice": None, "leftover": 7.0,
        }
        tug = desk_ats.public_tug(pick)
        self.assertTrue(tug["visual_only"])
        self.assertEqual(tug["fade"], "SEA")
        self.assertEqual(tug["steam"], "DAL")
        gated = {
            "sport": "NFL", "kind": "spread", "floor_strike": 3.0, "side": "YES",
            "call": "COVER", "leftover": 0.4, "quotes": {"yes_ask": 46.0},
            "close_time": "2026-08-16T00:00:00Z", "ticker": "T", "game": "G",
        }
        desk_ats.apply_ares_gates(gated, now=NOW)
        self.assertEqual(gated["call"], "WAIT")
        self.assertIn("KEY NUMBER", gated.get("gate") or "")
        tug2 = desk_ats.public_tug(gated)
        self.assertTrue(tug2["visual_only"])
        self.assertEqual(gated["call"], "WAIT")

    async def test_gates_attach_on_board_and_sit_live(self):
        events = [{
            "id": "4018",
            "shortName": "DAL @ SEA",
            "status": "in",
            "competitors": [{"abbreviation": "DAL"}, {"abbreviation": "SEA"}],
            "broadcasts": [{"type": "TV", "isNational": True, "shortName": "FOX"}],
        }]
        board = await desk_ats.build_board(
            fetch=_fetch_factory(), now=NOW, force=True, watch_events=events,
        )
        self.assertEqual(board["gates"], list(desk_ats.ARES_GATES))
        self.assertTrue(board["tug"]["visual_only"])
        self.assertIn("FADE", board["brains"])
        self.assertTrue(board["watch"].get("live"))
        self.assertFalse(board["follower"])
        self.assertFalse(board["live"])
        self.assertTrue(board["paper_only"])
        if board.get("pick") and not board["pick"].get("ice"):
            self.assertEqual(board["chair"]["eye"], "WAIT")
            self.assertIn("SIT AFTER KICK", board["pick"].get("gate") or board["chair"]["call"])


class AtsEaglesRankTests(unittest.TestCase):
    """Prefer PHI among tickets that already cleared Ares v1 gates. Ranking only."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        desk_ats.reset_for_tests(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def _row(self, **kw):
        base = {
            "kind": "ml",
            "leftover": 6.0,
            "ice": None,
            "unknown_book": False,
            "side": "YES",
        }
        base.update(kw)
        return base

    def test_parse_already_has_nfl_phi(self):
        blob, away, home = desk_ats.parse_event_teams("KXNFLGAME-26AUG17PHIDAL")
        self.assertEqual((blob, away, home), ("PHIDAL", "PHI", "DAL"))
        self.assertEqual(desk_ats.ticker_side_code("KXNFLGAME-26AUG17PHIDAL-PHI"), "PHI")
        self.assertIn("PHI", desk_ats.TEAM_COLORS)
        self.assertTrue(desk_ats.eagles_ticket({
            "ticker": "KXNFLGAME-26AUG17PHIDAL-PHI",
            "event": "KXNFLGAME-26AUG17PHIDAL",
            "sport": "NFL",
            "home": "DAL",
            "away": "PHI",
        }))
        self.assertTrue(desk_ats.eagles_ticket({
            "ticker": "KXNFLGAME-26AUG17DALPHI-DAL",
            "event": "KXNFLGAME-26AUG17DALPHI",
            "sport": "NFL",
            "home": "PHI",
            "away": "DAL",
        }))
        self.assertTrue(desk_ats.eagles_ticket({
            "ticker": "KXNFLGAME-26AUG17PHIEAGNYG-PHI",
            "event": "KXNFLGAME-26AUG17PHIEAGNYG",
            "game": "PHIEAGNYG",
            "sport": "NFL",
        }))
        self.assertTrue(desk_ats.eagles_ticket({
            "ticker": "KXNFLGAME-26AUG17NYGDAL-NYG",
            "sport": "NFL",
            "title": "Will the Eagles cover?",
        }))
        self.assertFalse(desk_ats.eagles_ticket({
            "ticker": "KXNFLGAME-26AUG15DALSEA-SEA",
            "sport": "NFL",
            "home": "SEA",
            "away": "DAL",
        }))
        self.assertFalse(desk_ats.eagles_ticket({
            "ticker": "KXNBAGAME-26AUG16PHINYK-PHI",
            "sport": "NBA",
            "home": "NYK",
            "away": "PHI",
            "title": "Will Philadelphia win the 76ers game?",
        }))

    def test_eligible_phi_beats_nearer_non_phi_inside_72h(self):
        dal = self._row(
            ticker="KXNFLGAME-26AUG15DALSEA-SEA",
            game="DALSEA",
            sport="NFL",
            call="SEA",
            home="SEA",
            away="DAL",
            leftover=3.0,
            close_time="2026-08-16T00:00:00Z",
        )
        phi = self._row(
            ticker="KXNFLGAME-26AUG17PHIDAL-PHI",
            event="KXNFLGAME-26AUG17PHIDAL",
            game="PHIDAL",
            sport="NFL",
            call="PHI",
            home="DAL",
            away="PHI",
            leftover=4.0,
            close_time="2026-08-17T20:00:00Z",
        )
        self.assertTrue(desk_ats.playable_kick(dal, NOW))
        self.assertTrue(desk_ats.playable_kick(phi, NOW))
        self.assertLess(desk_ats.kick_mins_left(dal, NOW), desk_ats.kick_mins_left(phi, NOW))
        pick = desk_ats.pick_one_game([dal, phi], now=NOW)
        self.assertEqual(pick["game"], "PHIDAL")
        self.assertTrue(desk_ats.eagles_ticket(pick))
        phieag = self._row(
            ticker="KXNFLSPREAD-26AUG17PHIEAGNYG-PHI3",
            event="KXNFLSPREAD-26AUG17PHIEAGNYG",
            game="PHIEAGNYG",
            sport="NFL",
            kind="spread",
            call="COVER",
            leftover=5.0,
            close_time="2026-08-17T18:00:00Z",
        )
        self.assertEqual(desk_ats.pick_one_game([dal, phieag], now=NOW)["game"], "PHIEAGNYG")

    def test_phi_outside_72h_is_not_selected(self):
        far_phi = self._row(
            ticker="KXNFLGAME-26SEP18PHINYG-PHI",
            event="KXNFLGAME-26SEP18PHINYG",
            game="PHINYG",
            sport="NFL",
            call="PHI",
            home="NYG",
            away="PHI",
            leftover=18.0,
            close_time="2026-09-18T23:59:00Z",
        )
        dal = self._row(
            ticker="KXNFLGAME-26AUG15DALSEA-SEA",
            game="DALSEA",
            sport="NFL",
            call="SEA",
            leftover=3.0,
            close_time="2026-08-16T00:00:00Z",
        )
        self.assertTrue(desk_ats.beyond_kick_cap(far_phi, NOW))
        self.assertFalse(desk_ats.playable_kick(far_phi, NOW))
        self.assertEqual(desk_ats.pick_one_game([far_phi, dal], now=NOW)["game"], "DALSEA")
        self.assertIsNone(desk_ats.pick_one_game([far_phi], now=NOW))
        locked = dict(far_phi)
        self.assertIsNone(desk_ats.paper_lock_if_clear(locked, now=NOW))
        self.assertEqual(locked["call"], "WAIT")
        self.assertIn("72H", locked.get("gate") or "")

    def test_no_eagles_keeps_nearer_kick_dal(self):
        dal = self._row(
            ticker="KXNFLSPREAD-26AUG15DALSEA-SEA7",
            game="DALSEA",
            sport="NFL",
            kind="spread",
            call="COVER",
            leftover=3.0,
            close_time="2026-08-16T00:00:00Z",
            number="SEA -6.5",
        )
        later = self._row(
            ticker="KXNFLGAME-26AUG17KCNY-KC",
            game="KCNY",
            sport="NFL",
            call="KC",
            leftover=11.0,
            close_time="2026-08-17T20:00:00Z",
        )
        self.assertEqual(desk_ats.pick_one_game([later, dal], now=NOW)["game"], "DALSEA")
        iced = self._row(
            ticker="KXNFLGAME-26AUG17PHIDAL-PHI",
            game="PHIDAL",
            sport="NFL",
            call="PHI",
            home="DAL",
            away="PHI",
            leftover=9.0,
            ice="99¢ CHALK · ICE ON",
            close_time="2026-08-17T20:00:00Z",
        )
        self.assertEqual(desk_ats.pick_one_game([iced, dal], now=NOW)["game"], "DALSEA")

    def test_why_and_watch_say_bird_first(self):
        pick = {
            "call": "PHI", "kind": "ml", "number": "PHI @ DAL", "mid": 53, "leftover": 6.2,
            "public": "DAL", "steam": 0.0, "ice": None,
            "ticker": "KXNFLGAME-26AUG17PHIDAL-PHI",
            "event": "KXNFLGAME-26AUG17PHIDAL",
            "sport": "NFL", "home": "DAL", "away": "PHI",
            "title": "Will Philadelphia win?",
            "close_time": "2026-08-17T20:00:00Z",
        }
        why = desk_ats.build_why(pick, desk_ats.build_seats(pick), desk_ats.build_subs(pick))
        self.assertIn("BIRD FIRST", why["line"])
        self.assertIn("WHY · BIRD FIRST · PHI", why["line"])
        listed = desk_ats.bird_first_watch({
            "line": "WATCH · FOX · NATIONAL", "listed": True, "network": "FOX",
        }, pick)
        self.assertEqual(listed["line"], "WATCH · FOX · NATIONAL · BIRD FIRST")
        self.assertEqual(listed["network"], "FOX")
        dark = desk_ats.bird_first_watch(desk_ats.dark_watch("NO LISTING"), pick)
        self.assertIn("BIRD FIRST", dark["line"])
        self.assertNotIn("ESPN", dark["line"])
        other = desk_ats.bird_first_watch({
            "line": "WATCH · FOX · NATIONAL", "listed": True, "network": "FOX",
        }, {"sport": "NFL", "home": "SEA", "away": "DAL", "ticker": "KXNFLGAME-26AUG15DALSEA-SEA"})
        self.assertEqual(other["line"], "WATCH · FOX · NATIONAL")

    def test_no_follower_live_path_and_ares_weights_off_1h(self):
        self.assertNotIn("desk_ats", FOLLOWER)
        self.assertNotIn("desk_ats", LEADER)
        self.assertIn('"follower": False', ATS)
        self.assertIn("Never talks to Follower", ATS)
        self.assertNotIn("/api/follower/order", JS)
        self.assertIn("paper_only", ATS)
        self.assertNotIn("btc_shadow", ATS)
        self.assertNotIn("eth_shadow", ATS)
        for crypto in ("WICK", "PULSE", "DRIFT", "TAPE", "CARRY", "ORBIT"):
            self.assertNotIn(crypto, desk_ats.SPORT_BRAINS["NFL"])
            self.assertNotIn(crypto, desk_ats.SPORT_BRAINS["NBA"])
        self.assertNotIn("ARES", GATES)
        self.assertNotIn("eagles_ticket", GATES)
        self.assertNotIn("BIRD FIRST", GATES)

    async def test_board_prefers_eagles_and_stays_paper(self):
        extra = {
            "KXNFLGAME": [
                _m(
                    "KXNFLGAME-26AUG15DALSEA-SEA",
                    event="KXNFLGAME-26AUG15DALSEA",
                    title="Will Seattle win the Dallas vs Seattle Pro Football game?",
                    yes_bid="0.58",
                    yes_ask="0.59",
                    volume="94000",
                    close="2026-08-16T00:00:00Z",
                ),
                _m(
                    "KXNFLGAME-26AUG17PHIDAL-PHI",
                    event="KXNFLGAME-26AUG17PHIDAL",
                    title="Will Philadelphia win the Philadelphia vs Dallas Pro Football game?",
                    yes_bid="0.40",
                    yes_ask="0.41",
                    volume="88000",
                    close="2026-08-17T20:00:00Z",
                ),
            ],
            "KXNFLSPREAD": [],
            "KXNFLTOTAL": [],
        }
        events = [{
            "shortName": "PHI @ DAL",
            "competitors": [{"abbreviation": "PHI"}, {"abbreviation": "DAL"}],
            "broadcasts": [{"type": "TV", "isNational": True, "shortName": "FOX", "name": "FOX"}],
        }]
        board = await desk_ats.build_board(
            fetch=_fetch_factory(extra), now=NOW, force=True, watch_events=events,
        )
        pick = board["pick"]
        self.assertIsNotNone(pick)
        self.assertEqual(pick["game"], "PHIDAL")
        why_line = (board.get("why") or {}).get("line") or ""
        watch_line = (board.get("watch") or {}).get("line") or ""
        self.assertTrue("BIRD FIRST" in why_line or "BIRD FIRST" in watch_line, why_line + " | " + watch_line)
        self.assertIn("BIRD FIRST", watch_line)
        self.assertTrue(board["paper_only"])
        self.assertFalse(board["follower"])
        self.assertFalse(board["live"])
        self.assertEqual(board["leader"], "ARES")


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
_bind_async_tests(AtsGateTests)
_bind_async_tests(AtsEaglesRankTests)
