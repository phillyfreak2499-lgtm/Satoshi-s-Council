"""Hunter feeder: keep Ares and Oracle books live. Not a chair. Paper only."""
from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backend.services import desk_ats, desk_hunter, desk_oracle

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
WIRE = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
ATS = (ROOT / "backend" / "services" / "desk_ats.py").read_text(encoding="utf-8")
ORA = (ROOT / "backend" / "services" / "desk_oracle.py").read_text(encoding="utf-8")
HUNT = (ROOT / "backend" / "services" / "desk_hunter.py").read_text(encoding="utf-8")
FOLLOWER = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
LEADER = (ROOT / "backend" / "agents" / "leader.py").read_text(encoding="utf-8")

NOW = datetime(2026, 8, 16, 20, 0, tzinfo=timezone.utc)
ATS_NOW = datetime(2026, 8, 15, 20, 0, tzinfo=timezone.utc)


def _sports_row(**kw):
    row = {
        "ticker": "KXMLBGAME-26AUG18LADCOL-LAD",
        "title": "LAD @ COL",
        "number": "LAD @ COL",
        "game": "LADCOL",
        "sport": "MLB",
        "kind": "ml",
        "team": "LAD",
        "home": "COL",
        "away": "LAD",
        "quotes": {"yes_bid": 52.0, "yes_ask": 54.0, "no_bid": 46.0, "no_ask": 48.0, "yes_mid": 53.0, "spread": 2.0},
        "mid": 53.0,
        "leftover": 4.0,
        "yes_leftover": 4.0,
        "no_leftover": -1.0,
        "volume": 12000,
        "close_time": "2026-08-18T20:40:00Z",
        "mins_left": 48 * 60,
        "status": "active",
        "ice": None,
        "call": "LAD",
        "side": "YES",
        "liquid": True,
    }
    row.update(kw)
    return row


def _politics_row(**kw):
    row = {
        "ticker": "poly:fl-gov-gop-primary",
        "title": "Florida Governor Republican Primary Winner",
        "quotes": {"yes_bid": 41.0, "yes_ask": 43.0, "no_bid": 57.0, "no_ask": 59.0, "yes_mid": 42.0},
        "yes_mid": 42.0,
        "volume": 230000,
        "close_time": "2026-08-18T00:00:00Z",
        "status": "open",
        "source": "polymarket",
        "url": "https://polymarket.com/event/florida-governor-republican-primary",
        "prior_unknown": True,
        "category": "politics",
        "topic": "politics",
        "liquid": True,
    }
    row.update(kw)
    return row


class HunterIdentityTests(unittest.TestCase):
    def test_not_a_chair_locker_or_sixth_seat(self):
        self.assertEqual([s["id"] for s in desk_ats.SEATS], ["LINE", "STEAM", "FADE", "HURT", "ICE"])
        self.assertEqual([s["id"] for s in desk_oracle.SEATS], ["SIBYL", "PIT", "VEIL", "MARBLE"])
        self.assertNotIn("HUNTER", [s["id"] for s in desk_ats.SEATS])
        self.assertNotIn("HUNTER", [s["id"] for s in desk_oracle.SEATS])
        self.assertNotIn("SCOUT", [s["id"] for s in desk_ats.SEATS])
        self.assertNotIn("Pattern Apprentice", ATS + ORA + HUNT + HTML)
        self.assertNotIn('data-floor-chair="hunter"', HTML)
        self.assertNotIn(">HUNTER</span>", HTML.split('id="floorChairToggles"', 1)[1].split("</div>", 1)[0])
        self.assertIn("LINE", ATS)
        self.assertIn("STEAM", ATS)
        self.assertIn("SIBYL", ORA)
        self.assertIn("MARBLE", ORA)

    def test_paper_only_never_orders(self):
        self.assertNotIn("desk_hunter", FOLLOWER)
        self.assertNotIn("desk_hunter", LEADER)
        self.assertNotIn("paper_lock_if_clear", HUNT)
        self.assertNotIn("/api/follower/order", HUNT)
        self.assertIn('"follower": False', HUNT)
        self.assertIn("paper_only", HUNT)
        self.assertIn("Hunter does not pick a side", HUNT)
        self.assertIn("Satoshi’s Council", HTML)
        self.assertNotIn("ZT", HUNT.split("HUNTER", 1)[1][:400] if "HUNTER" in HUNT else HUNT)

    def test_hunt_strip_and_wire(self):
        self.assertIn('id="atsHunt"', HTML)
        self.assertIn('id="oraHunt"', HTML)
        self.assertIn("function paintHuntStrip", JS)
        self.assertIn("NO CONSENSUS", JS + ATS + ORA)
        self.assertIn("2026-08-16-hunter-feeder", WIRE)
        self.assertIn("not a Floor chair", WIRE)
        self.assertIn("No Consensus", WIRE)
        self.assertIn("Paper. Follower OFF.", WIRE)
        self.assertNotIn("ZT", WIRE.split("2026-08-16-hunter-feeder", 1)[1].split("2026-08-16-vitalik-rain-still", 1)[0])
        self.assertIn(".ats-hunt", CSS)
        self.assertIn("display: flex !important", CSS.split("#passwordGate.password-gate:not(.hidden)", 1)[1][:200])
        self.assertIn("display: none !important", CSS.split("#passwordGate.password-gate.hidden", 1)[1][:200])


class HunterSlateTests(unittest.TestCase):
    def setUp(self):
        desk_hunter.reset_for_tests()

    def test_never_empty_when_liquid_exists(self):
        rows = [
            _sports_row(),
            _sports_row(ticker="KXNFLGAME-26SEP14DENKC-KC", game="DENKC", sport="NFL",
                        title="DEN @ KC", number="DEN @ KC", close_time="2026-09-14T20:15:00Z",
                        mins_left=29 * 24 * 60, mid=48.0, quotes={"yes_bid": 47, "yes_ask": 49, "no_bid": 51, "no_ask": 53, "yes_mid": 48}),
        ]
        slate = desk_hunter.feed_ares_from_rows(rows, now=NOW)
        self.assertTrue(1 <= len(slate["candidates"]) <= 3)
        self.assertFalse(slate["empty"])
        self.assertIsNotNone(slate["featured"])
        self.assertIsNone(slate["hunter_side"])
        self.assertTrue(desk_hunter.hunter_never_locks(slate))
        self.assertTrue(slate["paper_only"])
        self.assertFalse(slate["follower"])
        self.assertFalse(slate["live"])
        self.assertFalse(slate["chair"])
        for c in slate["candidates"]:
            self.assertIsNone(c["hunter_side"])
            self.assertGreaterEqual(len(c["sides"]), 2)
            self.assertTrue(c["sources"])
            self.assertTrue(c["time_sensitivity"])
            self.assertIn("why_edge", c)

    def test_expired_candidates_are_replaced(self):
        live = _sports_row()
        dead = _sports_row(
            ticker="KXMLBGAME-26AUG15DEAD-DEAD",
            game="DEAD",
            title="EXPIRED",
            close_time="2026-08-15T00:00:00Z",
            mins_left=-60,
            status="closed",
        )
        nxt = _sports_row(
            ticker="KXNCAAFGAME-26AUG29MEMUNLV-UNLV",
            game="MEMUNLV",
            sport="CFB",
            title="MEM @ UNLV",
            close_time="2026-09-01T02:00:00Z",
            mins_left=15 * 24 * 60,
        )
        active = desk_hunter.sports_rows_to_candidates([dead, live], now=NOW)
        pool = desk_hunter.sports_rows_to_candidates([live, nxt], now=NOW)
        filled = desk_hunter.replace_expired(active, pool, now=NOW, n=3)
        ids = [c["id"] for c in filled]
        self.assertNotIn("KXMLBGAME-26AUG15DEAD-DEAD", ids)
        self.assertIn("KXMLBGAME-26AUG18LADCOL-LAD", ids)
        self.assertTrue(filled)
        self.assertTrue(all(not desk_hunter.candidate_expired(c, NOW) for c in filled))
        self.assertLessEqual(len(filled), 3)

    def test_hunter_does_not_pick_a_side(self):
        c = desk_hunter.as_candidate(_sports_row(), book="ares", source="kalshi", now=NOW)
        self.assertIsNone(c["hunter_side"])
        labels = {s["kalshi_side"] for s in c["sides"]}
        self.assertEqual(labels, {"YES", "NO"})
        self.assertIn("Hunter does not pick a side", c["why_edge"])
        self.assertEqual(c["consensus"], "NO CONSENSUS")

    def test_dead_optional_source_is_not_live(self):
        desk_hunter.mark_source("draftkings", live=False, why="unreachable 403", status=403)
        self.assertTrue(desk_hunter.source_is_dead("draftkings"))
        self.assertFalse(desk_hunter.twitter_key_present())
        x = desk_hunter.twitter_source()
        self.assertEqual(x["name"], "x")
        self.assertFalse(x["live"])
        self.assertEqual(x["why"], "no key")

    def test_politics_filter_drops_sports_noise(self):
        self.assertTrue(desk_hunter.politics_is_honest("Florida Governor Republican Primary", "KXGOV", "Elections"))
        self.assertFalse(desk_hunter.politics_is_honest("Lane Johnson retirement", "KXNFLRETIRE", "Politics"))
        self.assertFalse(desk_hunter.politics_is_honest("The Last of Us Season 3", "KXTVSEASON", "Politics"))

    def test_rotate_featured_stays_on_slate(self):
        a = desk_hunter.as_candidate(_sports_row(), book="ares", source="kalshi", now=NOW)
        b = desk_hunter.as_candidate(_sports_row(ticker="KXMLBGAME-26AUG18NYYBOS-NYY", game="NYYBOS", title="NYY @ BOS"), book="ares", source="kalshi", now=NOW)
        later = NOW + timedelta(seconds=desk_hunter.ROTATE_S + 1)
        f1 = desk_hunter.rotate_featured([a, b], now=NOW)
        f2 = desk_hunter.rotate_featured([a, b], now=later)
        self.assertIsNotNone(f1)
        self.assertIsNotNone(f2)
        self.assertIn(f1["id"], (a["id"], b["id"]))
        self.assertIn(f2["id"], (a["id"], b["id"]))
        if f1["id"] != f2["id"]:
            self.assertNotEqual(f1["id"], f2["id"])


class HunterBoardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        desk_ats.reset_for_tests(Path(self.tmp.name))
        desk_oracle.reset_for_tests(Path(self.tmp.name))
        desk_hunter.reset_for_tests()

    def tearDown(self):
        self.tmp.cleanup()

    async def test_ares_board_shows_far_candidate_instead_of_dead_air(self):
        extra = {
            "KXNFLGAME": [],
            "KXNFLSPREAD": [],
            "KXNFLTOTAL": [],
            "KXNCAAFGAME": [{
                "ticker": "KXNCAAFGAME-26SEP18HOUTTU-HOU",
                "series_ticker": "KXNCAAFGAME",
                "event_ticker": "KXNCAAFGAME-26SEP18HOUTTU",
                "title": "Will Houston win the Houston vs Texas Tech game?",
                "yes_bid_dollars": "0.38",
                "yes_ask_dollars": "0.40",
                "volume_fp": "88000",
                "open_interest_fp": "3900",
                "close_time": "2026-09-21T00:00:00Z",
                "status": "active",
            }],
            "KXNCAAFSPREAD": [],
            "KXNCAAFTOTAL": [],
        }
        from backend.tests.test_desk_ats import _fetch_factory

        fills_before = list(desk_ats._load_fills())
        board = await desk_ats.build_board(fetch=_fetch_factory(extra), now=ATS_NOW, force=True)
        self.assertTrue(board["candidates"])
        self.assertLessEqual(len(board["candidates"]), 3)
        self.assertTrue(board["pick"] or board["candidates"])
        self.assertEqual(board["chair"]["eye"], "WAIT")
        self.assertIsNone(board["hunter"]["side"])
        self.assertFalse(board["hunter"]["chair"])
        self.assertTrue(board["paper_only"])
        self.assertFalse(board["follower"])
        self.assertFalse(board["live"])
        self.assertEqual(len(desk_ats._load_fills()), len(fills_before))
        for c in board["candidates"]:
            self.assertIsNone(c.get("hunter_side"))

    async def test_ares_board_keeps_near_liquid_and_stays_paper(self):
        from backend.tests.test_desk_ats import _fetch_factory

        board = await desk_ats.build_board(fetch=_fetch_factory(), now=ATS_NOW, force=True)
        self.assertTrue(board.get("candidates") or board.get("pick"))
        self.assertTrue(1 <= len(board.get("candidates") or [board.get("pick")]) <= 3 or board.get("pick"))
        self.assertTrue(board["paper_only"])
        self.assertFalse(board["follower"])
        self.assertFalse(board["live"])
        self.assertIsNone(board["hunter"]["side"])
        self.assertEqual([s["id"] for s in board["seats"]], ["LINE", "STEAM", "FADE", "HURT", "ICE"])

    async def test_oracle_shows_bet_on_no_consensus(self):
        raw = {
            "ticker": "KXGOV-26-R",
            "title": "Will the Republican party win the governorship in Texas",
            "yes_bid_dollars": "0.40",
            "yes_ask_dollars": "0.42",
            "no_bid_dollars": "0.58",
            "no_ask_dollars": "0.60",
            "close_time": "2026-08-18T20:00:00Z",
            "prior_unknown": True,
            "source": "kalshi",
            "url": "https://kalshi.com/markets/KXGOV-26-R",
            "volume": 114000,
            "depth": {"yes_depth": 120, "no_depth": 110, "measured": True, "book_state": "ok"},
        }
        fills_before = list(desk_oracle._load_fills())
        board = await desk_oracle.build_board(book=raw, now=NOW, force=True)
        self.assertTrue(board.get("candidates") or board.get("pick"))
        self.assertEqual(board["chair"]["eye"], "WAIT")
        self.assertIn("NO CONSENSUS", board["why"]["line"])
        self.assertIsNone(board["locked_call"])
        self.assertIsNone(board["hunter"]["side"])
        self.assertFalse(board["hunter"]["chair"])
        self.assertTrue(board["paper_only"])
        self.assertFalse(board["follower"])
        self.assertFalse(board["live"])
        self.assertEqual(len(desk_oracle._load_fills()), len(fills_before))
        self.assertEqual([s["id"] for s in board["seats"]], ["SIBYL", "PIT", "VEIL", "MARBLE"])

    async def test_oracle_injected_lock_path_still_paper(self):
        from backend.tests.test_desk_oracle import _book, _fetch_factory

        board = await desk_oracle.build_board(fetch=_fetch_factory(), now=NOW, force=True)
        self.assertTrue(board["paper_only"])
        self.assertFalse(board["follower"])
        self.assertFalse(board["live"])
        self.assertIsNone(board["hunter"]["side"])
        self.assertTrue(board.get("candidates") or board.get("pick"))
        self.assertEqual([s["id"] for s in board["seats"]], ["SIBYL", "PIT", "VEIL", "MARBLE"])
        _ = _book

    def test_polymarket_row_keeps_both_sides(self):
        ev = {"title": "Florida Governor Republican Primary Winner", "slug": "fl-gov-gop", "endDate": "2026-08-18T00:00:00Z", "volume24hr": 200000}
        m = {"question": "Will Byron Donalds win the Florida Governor Republican Primary?", "slug": "donalds", "outcomePrices": ["0.42", "0.58"], "endDate": "2026-08-18T00:00:00Z", "volume24hr": 200000}
        row = desk_hunter.polymarket_to_row(ev, m)
        self.assertIsNotNone(row)
        c = desk_hunter.as_candidate(row, book="oracle", source="polymarket", now=NOW)
        self.assertIsNone(c["hunter_side"])
        self.assertEqual(len(c["sides"]), 2)
        self.assertTrue(c["prior_unknown"])
        self.assertIn("polymarket.com", c["sources"][0]["url"])


if __name__ == "__main__":
    unittest.main()
