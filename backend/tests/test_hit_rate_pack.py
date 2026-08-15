"""Hit-rate pack: dead book, time gates, BTC-leads-ETH, calibrated P(finish)."""
from __future__ import annotations

import unittest
from datetime import datetime, timezone

from backend.agents.chair_gates import (
    build_btc_lead,
    chair_bin_settled_count,
    chair_conf_bin,
    dead_book_reason,
    early_lock_blocked,
    estimate_p_finish,
    eth_fades_btc_impulse,
    hot_chair_bin_faded,
    is_actually_settled,
    late_spot_decisive,
    lock_force_allowed,
    playable_yes_mid,
)
from backend.data.cfbenchmarks import (
    last15_spot,
    last_tick_wick_averaged_away,
    parse_cfb_values,
    pick_research_spot,
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

    def test_hot_bin_faded_until_settled_hours(self):
        self.assertEqual(chair_conf_bin(91), "90+")
        self.assertTrue(hot_chair_bin_faded(91, 0))
        self.assertFalse(hot_chair_bin_faded(70, 0))
        # 90%+ stays cold even if lifetime n is large
        self.assertLessEqual(estimate_p_finish(91, 80, bin_settled_n=0), 0.62)
        warm = estimate_p_finish(91, 80, bin_settled_n=80)
        self.assertGreater(warm, 0.62)

    def test_open_1062_1063_do_not_count(self):
        self.assertFalse(is_actually_settled({
            "id": 1062, "status": "open", "actual_outcome": None, "y_finish": None,
        }))
        self.assertFalse(is_actually_settled({
            "id": 1063, "actual_outcome": None, "settled_at": None,
        }))
        self.assertEqual(chair_bin_settled_count([
            {"id": 1062, "confidence": 91, "actual_outcome": None},
            {"id": 1063, "confidence": 92, "status": "open"},
        ], "90+"), 0)
        self.assertEqual(chair_bin_settled_count([{
            "id": 1062,
            "confidence": 91,
            "y_finish": "DOWN",
            "settled_at": "2026-08-14T19:02:44Z",
            "settle_reason": "finish_match",
        }], "90+"), 1)


class CfbSettleTests(unittest.TestCase):
    def test_60s_average_not_last_tick(self):
        now = 1_700_000_060.0
        snap = parse_cfb_values({
            "data": {
                "avg_60s_data": {"value": "100016.67", "window_size": 60},
                "payload": {"value": "101000", "time": now},
            }
        }, asset="btc")
        self.assertAlmostEqual(snap["avg_60s"], 100016.67, places=2)
        self.assertTrue(last_tick_wick_averaged_away(101_000, snap["avg_60s"]))
        self.assertIsNone(last15_spot({"spot": 101_000, "kind": "last"}))
        self.assertAlmostEqual(last15_spot({"spot": snap["avg_60s"], "kind": "avg_60s"}), 100016.67, places=2)

    def test_research_rank_skips_binance_us(self):
        picked = pick_research_spot(
            cfb_avg_60s=None,
            vision=None,
            coinbase=99_000,
            binance_us=98_500,
            last_tick=101_000,
        )
        self.assertNotEqual(picked.get("source"), "binance.us")
        self.assertIsNone(last15_spot(picked))
        cfb = pick_research_spot(cfb_avg_60s=100_100, vision=99_000, coinbase=99_050, binance_us=98_000)
        self.assertEqual(cfb["source"], "cfb")
        self.assertEqual(cfb["kind"], "avg_60s")
        self.assertEqual(last15_spot(cfb), 100_100)

    def test_late15_uses_avg_not_wick(self):
        self.assertFalse(late_spot_decisive(None, 100_000, 10, 0.40))
        self.assertTrue(late_spot_decisive(100_400, 100_000, 10, 0.40))
        # wick last tick is not passed — 60s avg still at strike
        self.assertFalse(late_spot_decisive(100_000, 100_000, 10, 0.40))


class CoinGlassDisplayOnlyTests(unittest.TestCase):
    def test_funding_and_liq_cannot_force_lock(self):
        self.assertFalse(lock_force_allowed({"lock_force": False, "advisory": True}))
        self.assertFalse(lock_force_allowed({"advisory": True}))
        self.assertTrue(lock_force_allowed({"lock_force": True}))
        self.assertTrue(lock_force_allowed({}))

    def test_carry_marks_funding_advisory(self):
        import asyncio
        from backend.agents.funding import FundingSpecialist
        from backend.agents.liq import LiqSpecialist

        fund = asyncio.run(
            FundingSpecialist().get_signal({"funding_rate": 0.001, "open_interest": 9e9})
        )
        self.assertFalse(fund.features.get("lock_force"))
        self.assertTrue(fund.features.get("advisory"))
        liq = asyncio.run(
            LiqSpecialist().get_signal({
                "liq_long_usd": 8_000_000,
                "liq_short_usd": 500_000,
                "asset": "btc",
                "candles": [{"close": 100, "volume": 1}] * 12,
                "coinglass": {"interval": "1h"},
            })
        )
        self.assertFalse(liq.features.get("lock_force"))
        self.assertTrue(liq.features.get("not_p_finish"))


if __name__ == "__main__":
    unittest.main()
