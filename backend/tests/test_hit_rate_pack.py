"""Hit-rate pack: dead book, time gates, BTC-leads-ETH, calibrated P(finish)."""
from __future__ import annotations

import unittest
from datetime import datetime, timezone

from backend.agents.chair_gates import (
    build_btc_lead,
    dead_book_reason,
    early_lock_blocked,
    estimate_p_finish,
    eth_fades_btc_impulse,
    late_spot_decisive,
    playable_yes_mid,
)


class DeadBookTests(unittest.TestCase):
    def test_mid_outside_20_80(self):
        self.assertFalse(playable_yes_mid(12))
        self.assertFalse(playable_yes_mid(91))
        self.assertTrue(playable_yes_mid(50))
        self.assertIn("outside 20–80", dead_book_reason(None, "UP", 96) or "")

    def test_chosen_side_already_80(self):
        # 80¢ is still a playable mid; chosen-side cap is the skip
        why = dead_book_reason(None, "UP", 80)
        self.assertIsNotNone(why)
        self.assertIn("already", why)

    def test_one_sided_yes_depth_zero(self):
        depth = {"yes_depth": 0, "no_depth": 40, "yes_bid_px": 50, "no_bid_px": 50}
        why = dead_book_reason(depth, "UP", 50)
        self.assertEqual(why, "one-sided book · yes_depth 0")

    def test_no_at_99(self):
        depth = {"yes_depth": 10, "no_depth": 10, "yes_bid_px": 1, "no_bid_px": 99}
        why = dead_book_reason(depth, "UP", 50)
        self.assertIn("NO at 99", why or "")


class TimeGateTests(unittest.TestCase):
    def test_first_10_minutes_blocked(self):
        self.assertTrue(early_lock_blocked(55, 60, 10))
        self.assertFalse(early_lock_blocked(40, 60, 10))
        self.assertFalse(early_lock_blocked(None, 60, 10))

    def test_late_spot_must_be_decisive(self):
        # 0.40% hourly vol, 10m left → expected ≈ 0.40% * sqrt(10/60) ≈ 0.163%
        self.assertFalse(late_spot_decisive(100_000, 100_000, 10, 0.40))
        self.assertTrue(late_spot_decisive(100_400, 100_000, 10, 0.40))
        self.assertFalse(late_spot_decisive(None, 100_000, 10, 0.40))


class BtcLeadsEthTests(unittest.TestCase):
    def test_impulse_from_hour_delta(self):
        now = datetime(2026, 8, 14, 21, 30, tzinfo=timezone.utc)
        hour_ms = int(datetime(2026, 8, 14, 21, 0, tzinfo=timezone.utc).timestamp() * 1000)
        candles = [{"t": hour_ms, "o": 100_000, "c": 100_200}]
        lead = build_btc_lead("WAIT", False, candles, 100_200, now=now)
        self.assertEqual(lead["direction"], "UP")
        self.assertTrue(lead["impulse"])
        self.assertAlmostEqual(lead["spot_delta_pct"], 0.2, places=2)

    def test_eth_cannot_fade_btc_impulse(self):
        lead = {"direction": "UP", "impulse": True, "locked": True}
        self.assertTrue(eth_fades_btc_impulse("DOWN", lead))
        self.assertFalse(eth_fades_btc_impulse("UP", lead))
        self.assertFalse(eth_fades_btc_impulse("DOWN", {"direction": "UP", "impulse": False}))

    def test_locked_btc_is_impulse(self):
        lead = build_btc_lead("UP", True, [], None)
        self.assertTrue(lead["impulse"])
        self.assertTrue(lead["strong"])
        self.assertEqual(lead["direction"], "UP")


class CalibrateTests(unittest.TestCase):
    def test_cold_91_is_not_p_finish(self):
        self.assertLessEqual(estimate_p_finish(91, 0), 0.62)
        self.assertLessEqual(estimate_p_finish(99, 10), 0.62)


if __name__ == "__main__":
    unittest.main()
