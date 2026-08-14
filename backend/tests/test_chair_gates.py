"""Paper-only Chair gate math. No network, no live Kalshi orders."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from backend.agents.chair_gates import (
    band_tighten,
    book_too_thin,
    clamp_p_finish,
    compute_ev_cents,
    dead_book_reason,
    early_lock_blocked,
    estimate_p_finish,
    eth_fades_btc_impulse,
    ev_gate_blocks,
    finish_outcome,
    kalshi_taker_fee_cents,
    late_spot_decisive,
    official_window_due,
    pick_settle_spot,
    odds_band_key,
    parse_book_depth,
    playable_yes_mid,
    time_ev_hurdles,
    build_btc_lead,
)
from backend.agents.leader import Leader
from backend.config import settings
from backend.learning.adaptive import AdaptiveLearner


class ClampAndEvTests(unittest.TestCase):
    def test_clamp_p_finish(self):
        self.assertEqual(clamp_p_finish(0), 0.01)
        self.assertAlmostEqual(clamp_p_finish(50), 0.50)
        self.assertEqual(clamp_p_finish(100), 0.99)
        self.assertEqual(clamp_p_finish(150), 0.99)
        self.assertEqual(clamp_p_finish(None), 0.01)

    def test_ev_cents_formula(self):
        # Paper-fill at ask: 100*P − ask − fee − half-spread
        self.assertAlmostEqual(compute_ev_cents(0.70, 50.0, 4.0, fee_cents=0.0), 18.0)
        self.assertAlmostEqual(kalshi_taker_fee_cents(50.0), 1.75)
        self.assertAlmostEqual(compute_ev_cents(0.70, 50.0, 4.0), 16.25)

    def test_estimate_p_finish_shrinks_cold_91(self):
        # 91% Chair on a cold book is not P(finish)
        p = estimate_p_finish(91, 0)
        self.assertLessEqual(p, 0.62)
        self.assertGreater(p, 0.50)
        warm = estimate_p_finish(91, 80)
        self.assertLessEqual(warm, 0.80)
        self.assertGreater(warm, p)

    def test_ev_gate_wait(self):
        self.assertTrue(ev_gate_blocks(0.50, 10.0, 0.55, 3.0))
        self.assertTrue(ev_gate_blocks(0.70, 2.0, 0.55, 3.0))
        self.assertFalse(ev_gate_blocks(0.70, 18.0, 0.55, 3.0))


class TimeHurdleTests(unittest.TestCase):
    def test_early_patient(self):
        h = time_ev_hurdles(50.0, 60.0, min_p=0.55, min_ev=3.0)
        self.assertEqual(h["phase"], "early")
        self.assertAlmostEqual(h["min_ev"], 4.5)
        self.assertAlmostEqual(h["min_p"], 0.55)

    def test_middle_selective(self):
        h = time_ev_hurdles(30.0, 60.0, min_p=0.55, min_ev=3.0)
        self.assertEqual(h["phase"], "middle")
        self.assertAlmostEqual(h["min_ev"], 3.0)
        self.assertAlmostEqual(h["min_p"], 0.55)

    def test_late_strong_misprice(self):
        h = time_ev_hurdles(10.0, 60.0, min_p=0.55, min_ev=3.0)
        self.assertEqual(h["phase"], "late")
        self.assertAlmostEqual(h["min_p"], 0.70)
        self.assertAlmostEqual(h["min_ev"], 8.0)

    def test_late_wins_on_short_window(self):
        h = time_ev_hurdles(12.0, 15.0, min_p=0.55, min_ev=3.0)
        self.assertEqual(h["phase"], "late")


class BookDepthTests(unittest.TestCase):
    def test_parse_nested_orderbook(self):
        book = {"orderbook": {"yes": [[48, 20], [47, 10]], "no": [[51, 3], [50, 8]]}}
        d = parse_book_depth(book)
        self.assertTrue(d["has_size"])
        self.assertEqual(d["yes_bid_sz"], 20)
        self.assertEqual(d["no_bid_sz"], 3)
        self.assertGreaterEqual(d["yes_depth"], 20)

    def test_thin_chosen_side_waits(self):
        d = parse_book_depth({"yes": [[50, 40]], "no": [[49, 1]]})
        self.assertFalse(book_too_thin(d, "UP", 5.0))
        self.assertTrue(book_too_thin(d, "DOWN", 5.0))

    def test_missing_book_does_not_wait(self):
        self.assertFalse(book_too_thin(parse_book_depth(None), "UP", 5.0))
        self.assertFalse(book_too_thin({"has_size": False}, "UP", 5.0))


class WindowStrikeTests(unittest.TestCase):
    def test_official_close_only(self):
        now = datetime(2026, 8, 14, 21, 0, tzinfo=timezone.utc)
        close = (now - timedelta(minutes=1)).isoformat()
        future = (now + timedelta(minutes=10)).isoformat()
        self.assertTrue(official_window_due(close, now=now))
        self.assertFalse(official_window_due(future, now=now))
        self.assertFalse(official_window_due(None, now=now))
        self.assertFalse(official_window_due("not-a-time", now=now))

    def test_exact_strike_finish(self):
        self.assertEqual(finish_outcome(100_100, 100_000), "UP")
        self.assertEqual(finish_outcome(99_900, 100_000), "DOWN")
        self.assertIsNone(finish_outcome(100_000, 100_000))
        self.assertIsNone(finish_outcome(None, 100_000))

    def test_pick_settle_spot_skips_zero_and_uses_last(self):
        self.assertEqual(pick_settle_spot(100_100, None), 100_100)
        self.assertEqual(pick_settle_spot(0, 99_900), 99_900)
        self.assertEqual(pick_settle_spot(None, 99_900), 99_900)
        self.assertIsNone(pick_settle_spot(0, None))
        self.assertIsNone(pick_settle_spot("bad", None))


class OddsBandCalibTests(unittest.TestCase):
    def test_band_keys(self):
        self.assertEqual(odds_band_key(42), "40-50")
        self.assertEqual(odds_band_key(65), "60-70")
        self.assertEqual(odds_band_key(81), "80-100")

    def test_tighten_losing_band(self):
        cold = band_tighten({"tries": 3, "hits": 0, "p_sum": 2.1, "pnl_sum": -30}, min_n=8)
        self.assertFalse(cold["losing"])
        self.assertEqual(cold["p_add"], 0.0)
        hot_lose = band_tighten(
            {"tries": 10, "hits": 3, "p_sum": 7.0, "pnl_sum": -40.0},
            min_n=8,
            miss_gap=0.08,
        )
        self.assertTrue(hot_lose["losing"])
        self.assertGreater(hot_lose["p_add"], 0.0)
        self.assertGreater(hot_lose["ev_add"], 0.0)

    def test_learner_tightens_after_losing_finishes(self):
        learner = AdaptiveLearner()
        for _ in range(10):
            learner.record_finish_calibration(side_odds=55.0, p_finish=0.70, finished=False, pnl=-25.0)
        tight = learner.odds_band_tighten(55.0)
        self.assertTrue(tight["losing"])
        self.assertAlmostEqual(tight["p_add"], float(settings.CALIB_P_TIGHTEN))
        self.assertAlmostEqual(tight["ev_add"], float(settings.CALIB_EV_TIGHTEN))


class LeaderPriceEdgeTests(unittest.TestCase):
    def test_price_edge_middle_and_late(self):
        chair = Leader()
        chair.edge["total"] = 80
        mid = chair._price_edge(
            70, "UP", 50.0,
            {"spread_cents": 4.0, "mins_left": 30, "window_minutes": 60, "settled_n": 80},
        )
        # shrink 0.85: 0.50 + 0.20*0.85 = 0.67; EV = 67 − 50 − 1.75 − 2 = 13.25
        self.assertAlmostEqual(mid["p_finish"], 0.67)
        self.assertAlmostEqual(mid["ev_cents"], 13.25)
        self.assertEqual(mid["phase"], "middle")
        self.assertFalse(ev_gate_blocks(mid["p_finish"], mid["ev_cents"], mid["min_p"], mid["min_ev"]))

        late = chair._price_edge(
            60, "UP", 55.0,
            {"spread_cents": 2.0, "mins_left": 10, "window_minutes": 60, "settled_n": 80},
        )
        self.assertEqual(late["phase"], "late")
        self.assertTrue(ev_gate_blocks(late["p_finish"], late["ev_cents"], late["min_p"], late["min_ev"]))

    def test_price_edge_uses_yes_ask_not_mid(self):
        chair = Leader()
        chair.edge["total"] = 80
        edge = chair._price_edge(
            70, "UP", 48.0,
            {
                "spread_cents": 4.0,
                "mins_left": 30,
                "window_minutes": 60,
                "settled_n": 80,
                "yes_ask": 52.0,
                "yes_bid": 48.0,
            },
        )
        # fill at 52¢ ask, not 48¢ mid
        self.assertAlmostEqual(edge["ev_cents"], compute_ev_cents(0.67, 52.0, 4.0))

    def test_wait_keeps_priced_edge_on_state(self):
        chair = Leader()
        chair._last_p_finish = 0.48
        chair._last_ev_cents = 1.2
        chair._last_ev_phase = "early"
        empty = chair._price_edge(48, None, 50.0, {"spread_cents": 2.0, "mins_left": 50})
        self.assertIsNone(empty["p_finish"])
        kept_p = empty["p_finish"] if empty["p_finish"] is not None else chair._last_p_finish
        kept_ev = empty["ev_cents"] if empty["ev_cents"] is not None else chair._last_ev_cents
        self.assertEqual(kept_p, 0.48)
        self.assertEqual(kept_ev, 1.2)

    def test_locked_call_carries_p_finish(self):
        chair = Leader()
        chair._set_window_lock("KXBTCD-TEST", "UP", 72, 0.8, up_pct=48.0, call_phase="entry")
        chair._locked_p_finish = 0.72
        chair._locked_ev_cents = 19.0
        chair._locked_floor_strike = 100000.0
        chair._locked_close_time = "2026-08-14T22:00:00Z"
        lc = chair._build_locked_call()
        self.assertTrue(lc["locked"])
        self.assertEqual(lc["p_finish"], 0.72)
        self.assertEqual(lc["ev_cents"], 19.0)
        self.assertEqual(lc["floor_strike"], 100000.0)


if __name__ == "__main__":
    unittest.main()
