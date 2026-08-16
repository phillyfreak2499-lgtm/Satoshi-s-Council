"""ORA gold tab kit. Chair ORACLE. Seats SIBYL/PIT/VEIL/MARBLE. Paper lock. No Apollo. No GLD."""
from __future__ import annotations

import json
import re
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from backend.services import desk_oracle

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
ORA = (ROOT / "backend" / "services" / "desk_oracle.py").read_text(encoding="utf-8")
FOLLOWER = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
LEADER = (ROOT / "backend" / "agents" / "leader.py").read_text(encoding="utf-8")
ROOM = ROOT / "frontend" / "static" / "oracle-room.jpg"
FACE = ROOT / "frontend" / "static" / "oracle-wait.jpg"
BOTS = ROOT / "frontend" / "static" / "bots"

NOW = datetime(2026, 8, 16, 20, 0, tzinfo=timezone.utc)


def _wire_rows() -> list[dict]:
    m = re.search(r"window\.COUNCIL_WIRE\s*=\s*(\[[\s\S]*?\]);", WIRE_JS)
    return json.loads(m.group(1))


def _book(
    *,
    ticker: str = "KXBTCD-26AUG1615-T64000",
    yes_bid: str = "0.40",
    yes_ask: str = "0.42",
    no_bid: str = "0.58",
    no_ask: str = "0.60",
    yes_depth: float = 120,
    no_depth: float = 110,
    measured: bool = True,
    close: str = "2026-08-16T20:00:00Z",
    strike: float = 64000,
) -> dict:
    return {
        "ticker": ticker,
        "title": "BTC 1H",
        "yes_bid_dollars": yes_bid,
        "yes_ask_dollars": yes_ask,
        "no_bid_dollars": no_bid,
        "no_ask_dollars": no_ask,
        "close_time": close,
        "floor_strike": strike,
        "depth": {
            "yes_depth": yes_depth,
            "no_depth": no_depth,
            "measured": measured,
            "book_state": "ok" if measured and yes_depth > 0 and no_depth > 0 else "dead",
        },
    }


def _fetch_factory(markets=None, book=None):
    async def fetch(path: str, params: dict):
        if book is not None:
            return {"book": book}
        return {"markets": markets if markets is not None else [_book()]}
    return fetch


class OraGoldTabTests(unittest.TestCase):
    def test_ora_tab_not_gld(self):
        row = HTML.split('id="modeTabs"', 1)[1].split('id="tabFloor"', 1)[0]
        self.assertIn('id="focusOra"', row)
        self.assertIn('data-focus="oracle"', row)
        self.assertIn(">ORA</button>", row)
        self.assertIn("Focus ORACLE / CRT", row)
        self.assertNotIn(">GLD</button>", HTML)
        self.assertNotIn('id="focusGld"', HTML)
        self.assertNotIn('data-focus="gld"', HTML)
        self.assertNotIn("APOLLO", HTML)
        self.assertNotIn('id="focusApollo"', HTML)
        self.assertIn('bind(focusOra, "oracle")', JS)
        self.assertIn('#focusOra.focus-active', CSS)
        self.assertIn('body[data-focus-table="oracle"] #focusBtc.focus-active', CSS)

    def test_chair_name_stays_oracle(self):
        self.assertIn('return "ORACLE"', JS.split("function chairNameOf", 1)[1][:240])
        self.assertIn(">ORACLE</span>", HTML)
        self.assertNotIn(">GLD</span>", HTML.split('id="floorChairToggles"', 1)[1].split("</div>", 1)[0])


class OraSeatTests(unittest.TestCase):
    def test_sibyl_pit_veil_marble_no_apollo(self):
        self.assertIn('ORACLE_SEAT_IDS = ["SIBYL", "PIT", "VEIL", "MARBLE"]', JS)
        self.assertIn("THE READ", JS)
        self.assertIn("THE WELL", JS)
        self.assertIn("THE MASK", JS)
        self.assertIn("THE SLAB", JS)
        self.assertIn('id="oracleBotsGuide"', HTML)
        self.assertIn("SIBYL · PIT · VEIL · MARBLE", HTML)
        self.assertNotIn("APOLLO", JS.split("ORACLE_SEAT_IDS", 1)[1][:200])
        note = WIRE_JS.split("2026-08-16-ora-kit", 1)[1].split("2026-08-16-phone-oracle", 1)[0]
        self.assertIn("SIBYL", note)
        self.assertIn("MARBLE", note)
        self.assertIn("function renderOracleBotsGuide", JS)
        self.assertNotIn("ORACLE does not place orders", JS)
        self.assertNotIn("ORACLE does not place orders", HTML.split('id="oraWhy"', 1)[1][:800])
        self.assertNotIn("They watch. They do not vote.", JS)

    def test_roster_isolation_no_leaked_bots(self):
        guide = JS.split("function renderOracleBotsGuide", 1)[1].split("function renderAtsBotsGuide", 1)[0]
        self.assertIn("ORACLE_SEAT_MARKS", guide)
        self.assertIn("frontBotMarkHtml", guide)
        self.assertNotIn("ora-seat-mark", guide)
        self.assertNotIn("WICK", guide)
        self.assertNotIn("PULSE", guide)
        self.assertNotIn("TAPE", guide)
        self.assertNotIn("LINE", guide)
        self.assertNotIn("STEAM", guide)
        self.assertNotIn("GLASS", guide)
        art = JS.split("const oracleLive", 1)[1][:500]
        self.assertIn('["sibyl", "pit", "veil", "marble"]', art)
        self.assertIn("oracleLive", JS)
        self.assertIn('body[data-focus-table="oracle"] #botsGrid', CSS)
        dash = JS.split("function renderDashboard", 1)[1].split("function updateLaw", 1)[0]
        self.assertIn("isOracleSeatKey", dash)
        ranks = JS.split("function renderRanksBoard", 1)[1].split("function tickClock", 1)[0]
        self.assertIn("isOracleSeatKey", ranks)
        for leak in ("candle", "volume", "momentum", "orderflow", "AGENT_ORDER"):
            self.assertNotIn(leak, guide)

    def test_logos_are_real_marks(self):
        for name in ("sibyl.svg", "ora-pit.svg", "veil.svg", "marble.svg"):
            path = BOTS / name
            self.assertTrue(path.is_file(), name)
            self.assertGreater(path.stat().st_size, 200)
            self.assertIn(b"<svg", path.read_bytes()[:80])
        self.assertIn("/static/bots/sibyl.svg", JS + ORA)
        self.assertIn("/static/bots/ora-pit.svg", JS + ORA)
        self.assertIn("/static/bots/veil.svg", JS + ORA)
        self.assertIn("/static/bots/marble.svg", JS + ORA)
        self.assertIn("/oracle-wait.jpg", JS)
        self.assertNotIn("/static/bots/pit.png", JS.split("ORACLE_SEAT_MARKS", 1)[1][:400])
        self.assertIn('chairPortraitOf', JS)
        face = JS.split("function chairPortraitOf", 1)[1][:280]
        self.assertIn("oraclePortrait", face)
        self.assertNotIn("oracle-up", face)
        self.assertNotIn("oracle-down", face)


class OraRoomPlateTests(unittest.TestCase):
    def test_room_image_separate_from_face(self):
        self.assertTrue(ROOM.is_file())
        self.assertGreater(ROOM.stat().st_size, 20_000)
        self.assertTrue(FACE.is_file())
        self.assertNotEqual(ROOM.read_bytes(), FACE.read_bytes())
        self.assertNotEqual(ROOM.stat().st_size, FACE.stat().st_size)
        head = ROOM.read_bytes()[:3]
        self.assertEqual(head, b"\xff\xd8\xff")
        self.assertIn("/oracle-room.jpg", CSS)
        self.assertIn("/oracle-wait.jpg", JS)
        self.assertIn('@app.get("/oracle-room.jpg")', MAIN)
        self.assertIn('if (key === "oracle") return "oracle"', JS)
        self.assertIn('room === "oracle"', JS)
        self.assertIn('data-chair-room="oracle"', CSS)
        self.assertNotIn("/oracle-room.jpg", JS.split("oraclePortrait.src", 1)[1][:200])


class OraHudKitTests(unittest.TestCase):
    def test_crt_hud_hides_crypto(self):
        self.assertIn('id="oraWhy"', HTML)
        self.assertIn('id="oraWatch"', HTML)
        self.assertIn('id="oraWatchStrip"', HTML)
        self.assertIn("function paintOraWhy", JS)
        self.assertIn("function paintOraWatch", JS)
        chrome = JS.split("if (oracle)", 1)[1][:500]
        self.assertIn('ledLabel.textContent = card.status === "LOCK" ? "LOCK" : "WAIT"', chrome)
        hide = CSS.split('body[data-focus-table="oracle"] #stripBtcPx', 1)[1][:400]
        self.assertIn("#stripEthPx", hide)
        self.assertIn(".odds-live", hide)
        self.assertIn('body[data-focus-table="oracle"] .chart-card.chart-crypto-odds', CSS)
        self.assertNotIn("spreadsheet", JS.split("function oracleTableState", 1)[1][:800].lower())
        self.assertNotIn("does not place orders", JS.split("function paintFrontWindowChrome", 1)[1][:2500].lower())


class OraGateStillCleanTests(unittest.TestCase):
    def test_no_comma_flex(self):
        self.assertNotIn("#passwordGate.password-gate,", CSS)
        for _m in re.finditer(r"#passwordGate\.password-gate\s*\{", CSS):
            self.fail("bare #passwordGate.password-gate { must not exist")
        self.assertIn("#passwordGate.password-gate:not(.hidden)", CSS)
        hidden = CSS.split("#passwordGate.password-gate.hidden", 1)[1].split("}", 1)[0]
        self.assertIn("display: none !important", hidden)


class OraWireTests(unittest.TestCase):
    def test_newest_is_ora_kit(self):
        rows = _wire_rows()
        self.assertEqual(next(r["id"] for r in rows if r["id"] == "2026-08-16-ora-kit"), "2026-08-16-ora-kit")
        ora = next(r for r in rows if r["id"] == "2026-08-16-ora-kit")
        self.assertIn("ORA", ora["why"])
        self.assertIn("GLD", ora["why"])
        self.assertIn("SIBYL", ora["why"])
        self.assertIn("Paper", ora["why"])
        self.assertIn("Follower OFF", ora["why"])
        self.assertNotIn("ZT", ora["title"])
        self.assertNotIn("ZT", ora["why"])
        ats = [r["at"] for r in rows]
        self.assertEqual(ats, sorted(ats, reverse=True))

    def test_newest_is_oracle_can_call(self):
        rows = _wire_rows()
        ora = next(r for r in rows if r["id"] == "2026-08-16-oracle-can-call")
        self.assertIn("SIBYL", ora["why"])
        self.assertIn("MARBLE", ora["why"])
        self.assertIn("Paper", ora["why"])
        self.assertIn("Follower OFF", ora["why"])
        self.assertIn("20–80", ora["why"])
        self.assertNotIn("ZT", ora["title"])
        self.assertNotIn("ZT", ora["why"])
        self.assertNotIn("WATCH-only", ora["why"].replace("No WATCH-only", ""))


class OraPaperLockTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        desk_oracle.reset_for_tests(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_no_follower_and_paper_only(self):
        self.assertNotIn("desk_oracle", FOLLOWER)
        self.assertNotIn("desk_oracle", LEADER)
        self.assertIn("paper_only", ORA)
        self.assertIn('"follower": False', ORA)
        self.assertIn("Never talks to Follower", ORA)
        self.assertIn('@app.get("/api/oracle")', MAIN)
        self.assertGreater(MAIN.find("api_unknown"), MAIN.find("/api/oracle"))
        self.assertIn('fetch("/api/oracle"', JS)
        self.assertIn("function loadOracleTable", JS)
        self.assertIn("function liveCallCard", JS)
        card = JS.split("function liveCallCard", 1)[1].split("function liveCallHeadline", 1)[0]
        self.assertNotIn('dir = "WATCH"', card)
        self.assertNotIn('status = "WATCH"', card)

    async def test_agree_playable_paper_locks(self):
        board = await desk_oracle.build_board(fetch=_fetch_factory(), now=NOW, force=True)
        self.assertTrue(board["paper_only"])
        self.assertFalse(board["follower"])
        self.assertFalse(board["live"])
        ids = [s["id"] for s in board["seats"]]
        self.assertEqual(ids, ["SIBYL", "PIT", "VEIL", "MARBLE"])
        dirs = {s["id"]: s["dir"] for s in board["seats"]}
        self.assertEqual(dirs["SIBYL"], "UP")
        self.assertEqual(dirs["PIT"], "UP")
        self.assertEqual(dirs["VEIL"], "UP")
        self.assertEqual(dirs["MARBLE"], "UP")
        self.assertEqual(board["chair"]["eye"], "UP")
        self.assertTrue(board["chair"]["locked"])
        self.assertIsNotNone(board["locked_call"])
        self.assertEqual(board["locked_call"]["direction"], "UP")
        self.assertIn("LOCK UP", board["why"]["line"])
        self.assertIn("TICKET ON THE GLASS", board["watch"]["line"])
        self.assertTrue(board["fills"])
        self.assertFalse(board["fills"][0]["follower"])
        self.assertFalse(board["fills"][0]["live"])
        self.assertTrue(board["fills"][0]["paper"])

    async def test_seats_split_sits(self):
        book = desk_oracle.normalize_book(_book())
        seats = desk_oracle.build_seats(book)
        seats[0]["dir"] = "UP"
        seats[1]["dir"] = "DOWN"
        seats[2]["dir"] = "UP"
        seats[3]["dir"] = "WAIT"
        board = await desk_oracle.build_board(book=book, seats=seats, now=NOW, force=True)
        self.assertEqual(board["chair"]["eye"], "WAIT")
        self.assertFalse(board["chair"]["locked"])
        self.assertIsNone(board["locked_call"])
        self.assertIn("SEATS SPLIT", board["why"]["line"])
        self.assertFalse(board["fills"])

    async def test_dead_book_sits(self):
        raw = _book(yes_depth=0, no_depth=0, measured=True)
        raw["depth"]["book_state"] = "dead"
        board = await desk_oracle.build_board(book=raw, now=NOW, force=True)
        self.assertEqual(board["chair"]["eye"], "WAIT")
        self.assertIsNone(board["locked_call"])
        self.assertIn("DEAD BOOK", board["why"]["line"])
        self.assertFalse(board["fills"])

    async def test_no_edge_after_vig_sits(self):
        raw = _book(yes_bid="0.56", yes_ask="0.62", no_bid="0.36", no_ask="0.44")
        board = await desk_oracle.build_board(book=raw, now=NOW, force=True)
        self.assertEqual(board["chair"]["eye"], "WAIT")
        self.assertIsNone(board["locked_call"])
        line = board["why"]["line"]
        self.assertTrue("NO EDGE" in line or "SEATS SPLIT" in line or "20–80" in line or "WAIT" in line)

    def test_product_copy_has_no_watch_only(self):
        self.assertNotIn("ORACLE does not place orders", JS)
        self.assertNotIn("WATCH only", JS)
        self.assertNotIn("Watch chair. Does not place orders.", JS)
        self.assertIn("Paper lock when the four agree", JS)
        card = JS.split("function liveCallCard", 1)[1].split("function liveCallHeadline", 1)[0]
        self.assertIn("LOCK ", card)
        self.assertIn("WAIT", card)
        self.assertNotIn("ZT", HTML.split('id="oracleBotsGuide"', 1)[1][:400])
        self.assertIn("Satoshi’s Council", HTML)


if __name__ == "__main__":
    unittest.main()
