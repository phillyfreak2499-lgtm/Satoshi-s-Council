"""Desk pack: Tape, Book, Night, Brain, News, Floor crawl + camera drift."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from backend.agents.chair_gates import parse_book_depth
from backend.services.desk_news import (
    fallback_macro_prints,
    headline_is_hour_relevant,
    heat_in_current_hour,
    is_stale,
    liq_burst_line,
    next_nfp,
    parse_ff_calendar,
    time_to_print_ct,
)
from backend.services.desk_pack import (
    book_flags,
    book_payload,
    brain_recap_from_report,
    calibration_strip,
    chair_tape_payload,
    tape_result,
    tape_row_from_call,
    window_label_ct,
)

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
NEWS_AGENT = (ROOT / "backend" / "agents" / "news.py").read_text(encoding="utf-8")
LEADER = (ROOT / "backend" / "agents" / "leader.py").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
FOLLOWER = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
CT = ZoneInfo("America/Chicago")


class MarkupTests(unittest.TestCase):
    def test_new_tabs_and_views(self):
        for needle in (
            'id="tabTape"',
            'id="tabBook"',
            'id="tabNight"',
            'id="tabBrain"',
            'id="tabNews"',
            'id="tapeView"',
            'id="bookView"',
            'id="brainView"',
            'id="newsView"',
            'id="floorCrawl"',
            "SATOSHI · BTC",
            "VITALIK · ETH",
            "COMING UP",
            "BREAKING",
            "CHAIR TAPE",
        ):
            self.assertIn(needle, HTML)

    def test_paper_tracker_untouched(self):
        self.assertIn('id="tabPaper"', HTML)
        self.assertIn('id="paperView"', HTML)
        self.assertIn("PAPER TRACKER", HTML)
        self.assertIn("Not the manual Paper Tracker", HTML)

    def test_product_name_stays(self):
        self.assertIn("Satoshi’s Council", HTML)
        self.assertNotIn("ZT ·", HTML)

    def test_night_is_chrome_less(self):
        self.assertIn("body.night-mode #beastBadge", CSS)
        self.assertIn("body.night-mode #tabSettings", CSS)
        self.assertIn("body.night-mode #tabBots", CSS)
        self.assertIn("body.night-mode #tabNight", CSS)
        self.assertIn("night-mode", JS)
        self.assertIn('data-mode="night"', HTML)

    def test_floor_crawl_and_drift(self):
        self.assertIn("function floorCameraOffset()", JS)
        self.assertIn("function paintFloorCrawl()", JS)
        self.assertIn("function floorLikeMode()", JS)
        self.assertIn("Slow room drift", JS)
        self.assertIn("floor-crawl-marquee", CSS)
        self.assertIn("No extra haze, particles, or purple", JS)

    def test_routes_exist(self):
        for needle in (
            '@app.get("/api/tape")',
            '@app.get("/api/book")',
            '@app.get("/api/brain/recap")',
            '@app.get("/api/news")',
        ):
            self.assertIn(needle, MAIN)
        # catch-all still last
        self.assertGreater(MAIN.find("api_unknown"), MAIN.find('/api/news'))


class TapeLogicTests(unittest.TestCase):
    def test_open_is_not_invented(self):
        row = {
            "direction": "UP",
            "asset": "btc",
            "p_finish": 0.70,
            "ev_cents": 4.0,
            "open_price": 48,
            "y_finish": None,
            "correct": None,
            "settle_reason": None,
            "ticker": "KXBTCD-26AUG1516-T100000",
        }
        self.assertEqual(tape_result(row), "OPEN")
        out = tape_row_from_call(row)
        self.assertEqual(out["result"], "OPEN")
        self.assertIsNone(out["pnl"])

    def test_official_finish_only(self):
        hit = {
            "direction": "UP",
            "asset": "btc",
            "p_finish": 0.70,
            "paper_pnl": 12.5,
            "y_finish": "UP",
            "correct": 1,
            "settle_reason": "finish_match",
            "side_ask": 48,
        }
        miss = dict(hit, correct=0, settle_reason="finish_miss", y_finish="DOWN", paper_pnl=-25)
        self.assertEqual(tape_result(hit), "HIT")
        self.assertEqual(tape_result(miss), "MISS")
        fake = dict(hit, y_finish=None, settle_reason="spot_guess")
        self.assertEqual(tape_result(fake), "OPEN")

    def test_calibration_said_70_hit_50(self):
        rows = [
            {"p_finish": 0.70, "y_finish": "UP", "correct": 1, "settle_reason": "finish_match", "direction": "UP"},
            {"p_finish": 0.72, "y_finish": "DOWN", "correct": 0, "settle_reason": "finish_miss", "direction": "UP"},
        ]
        strip = calibration_strip(rows)
        bucket = next(b for b in strip if b["bucket"] == "70–80%")
        self.assertEqual(bucket["n"], 2)
        self.assertAlmostEqual(bucket["predicted"], 0.71, places=2)
        self.assertAlmostEqual(bucket["realized"], 0.50, places=2)

    def test_payload_empty_honest(self):
        p = chair_tape_payload([])
        self.assertTrue(p["empty"])
        self.assertEqual(p["rows"], [])

    def test_window_label_is_ct(self):
        label = window_label_ct("KXBTCD-26AUG1415-T62999.99")
        self.assertIn("CT", label)


class BookLogicTests(unittest.TestCase):
    def test_empty_and_99_wall(self):
        empty = book_flags(None)
        self.assertTrue(empty["empty"])
        self.assertEqual(empty["flag"], "empty book")
        wall = book_flags(
            {"yes_depth": 10, "no_depth": 10, "has_size": True, "yes_bid_px": 1, "no_bid_px": 99},
            yes_bid=1,
            no_bid=99,
        )
        self.assertTrue(wall["wall_99"])
        self.assertEqual(wall["flag"], "≥99¢ wall")

    def test_dual_payload(self):
        book = {
            "yes": [[48, 20], [47, 10]],
            "no": [[51, 15]],
        }
        depth = parse_book_depth(book)
        self.assertTrue(depth["has_size"])
        payload = book_payload(
            {"kalshi_ticker": "KXBTCD-26AUG1516-T1", "kalshi_yes_bid": 48, "kalshi_yes_ask": 50, "kalshi_orderbook": book},
            {"kalshi_ticker": "KXETHD-26AUG1516-T1", "kalshi_yes_bid": 44, "kalshi_yes_ask": 46, "kalshi_orderbook": book},
        )
        self.assertEqual(payload["satoshi"]["chair"], "SATOSHI")
        self.assertEqual(payload["vitalik"]["chair"], "VITALIK")


class BrainLogicTests(unittest.TestCase):
    def test_empty_huddle(self):
        rec = brain_recap_from_report(None)
        self.assertTrue(rec["empty"])
        self.assertIn("huddle", rec["note"].lower())

    def test_public_no_admin_knobs(self):
        rec = brain_recap_from_report(
            {
                "complete": True,
                "date": "2026-08-14",
                "went_well": ["Last-20 strong"],
                "went_poor": [],
                "patterns": ["edge alive"],
                "l20_bump": 0.08,
                "law_bump": {"value": 0.06},
                "top_ranks": [{"name": "WICK", "rank": 1, "win_rate": 0.62}],
            },
            hierarchy_btc=[{"display_name": "WIRE", "faded": True, "rank": 9, "win_rate": 0.31}],
            hierarchy_eth=[],
            btc_acc={"total": 10, "correct": 6, "accuracy_pct": 60},
            eth_acc={"total": 0, "correct": 0},
        )
        blob = str(rec)
        self.assertNotIn("l20_bump", rec)
        self.assertNotIn("law_bump", rec)
        self.assertNotIn("0.08", blob)
        self.assertFalse(rec["empty"])
        self.assertTrue(any(x.get("seat") == "WICK" for x in rec["louder"]))
        self.assertTrue(any(x.get("seat") == "WIRE" for x in rec["faded"]))
        self.assertEqual(rec["satoshi"]["chair"], "SATOSHI")
        self.assertEqual(rec["vitalik"]["chair"], "VITALIK")


class NewsLogicTests(unittest.TestCase):
    def test_filters_junk_keeps_macro(self):
        self.assertTrue(headline_is_hour_relevant("Bitcoin ETF inflows smash records"))
        self.assertTrue(headline_is_hour_relevant("FOMC holds rates, dollar jumps"))
        self.assertFalse(headline_is_hour_relevant("Shiba memecoin of the day airdrop"))

    def test_stale_after_six_hours(self):
        now = datetime(2026, 8, 15, 18, 0, tzinfo=timezone.utc)
        fresh = now - timedelta(hours=2)
        old = now - timedelta(hours=7)
        self.assertFalse(is_stale(fresh, now))
        self.assertTrue(is_stale(old, now))

    def test_heat_mark_current_hour(self):
        close = datetime(2026, 8, 15, 16, 0, tzinfo=timezone.utc)
        inside = datetime(2026, 8, 15, 15, 20, tzinfo=timezone.utc)
        outside = datetime(2026, 8, 15, 14, 10, tzinfo=timezone.utc)
        self.assertTrue(heat_in_current_hour(inside, close))
        self.assertFalse(heat_in_current_hour(outside, close))

    def test_times_are_chicago(self):
        when = datetime(2026, 8, 15, 12, 30, tzinfo=timezone.utc)
        now = datetime(2026, 8, 15, 11, 0, tzinfo=timezone.utc)
        eta = time_to_print_ct(when, now)
        self.assertIn("CT", eta)
        nfp = next_nfp(datetime(2026, 8, 15, 18, 0, tzinfo=timezone.utc))
        self.assertEqual(nfp.tzinfo, CT)
        self.assertGreater(nfp, datetime(2026, 8, 15, tzinfo=CT))
        prints = fallback_macro_prints(datetime(2026, 8, 15, 18, 0, tzinfo=timezone.utc))
        self.assertTrue(prints)
        self.assertTrue(any(p["kind"] in ("NFP", "FOMC", "CPI") for p in prints))

    def test_ff_calendar_filters_usd_macro(self):
        rows = [
            {"title": "CPI m/m", "country": "USD", "date": "2026-08-16T12:30:00+00:00", "impact": "High"},
            {"title": "Retail sales", "country": "EUR", "date": "2026-08-16T08:00:00+00:00", "impact": "High"},
            {"title": "Holiday", "country": "USD", "date": "2026-08-16T12:00:00+00:00", "impact": "Low"},
        ]
        now = datetime(2026, 8, 15, 12, 0, tzinfo=timezone.utc)
        out = parse_ff_calendar(rows, now)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["kind"], "CPI")
        self.assertIn("CT", out[0]["when_ct"])

    def test_liq_burst_optional(self):
        self.assertIsNone(liq_burst_line(None))
        self.assertIsNone(liq_burst_line({"liq_long_usd": 1, "liq_short_usd": 1}))
        line = liq_burst_line({"liq_long_usd": 80_000_000, "liq_short_usd": 10_000_000})
        self.assertIn("Liq burst", line or "")

    def test_news_does_not_touch_chair(self):
        self.assertIn("Fear&Greed", NEWS_AGENT)
        self.assertNotIn("desk_news", NEWS_AGENT)
        self.assertNotIn("desk_news", LEADER)
        self.assertNotIn("desk_news", GATES)
        self.assertIn("Headlines do not change Chair locks", HTML)
        self.assertIn("Display only. Headlines do not change Chair locks.", (ROOT / "backend" / "services" / "desk_news.py").read_text())


class FreezeTests(unittest.TestCase):
    def test_does_not_touch_follower_or_lock_math(self):
        self.assertNotIn("desk_pack", FOLLOWER)
        self.assertNotIn("desk_news", FOLLOWER)
        self.assertNotIn("from backend.services.desk_pack", GATES)
        self.assertIn("def decide_open_lock_grade", GATES)
        self.assertIn("function collectChairLocks()", JS)

    def test_js_wires_new_modes(self):
        self.assertIn("function loadChairTape()", JS)
        self.assertIn("function loadKalshiBook()", JS)
        self.assertIn("function loadBrainRecap()", JS)
        self.assertIn("function loadDeskNews()", JS)
        self.assertIn('mode === "night"', JS)
        self.assertIn("/api/tape", JS)
        self.assertIn("/api/book", JS)
        self.assertIn("/api/brain/recap", JS)
        self.assertIn("/api/news", JS)


if __name__ == "__main__":
    unittest.main()
