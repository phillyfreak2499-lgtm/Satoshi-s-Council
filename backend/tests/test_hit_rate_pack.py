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
    eth_paper_lock_blocked,
    eth_settled_n_for_zach,
    eth_shadow_pick,
    floor_scorecard,
    is_eth_shadow_row,
    hot_chair_bin_faded,
    is_actually_settled,
    late_spot_decisive,
    leftover_after_vig,
    lifetime_n_for_zach,
    lock_force_allowed,
    never_lock_near_certain,
    paper_stake_for_lock,
    playable_yes_mid,
    stuck_hours_open,
    zach_band_skips_preferred,
    zach_bar_reason,
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
        depth = {"yes_depth": 0, "no_depth": 40, "yes_bid_px": 50, "no_bid_px": 50, "has_size": True}
        why = dead_book_reason(depth, "UP", 50)
        self.assertEqual(why, "one-sided book · yes_depth 0")

    def test_both_zero_null_is_unknown_not_dead(self):
        self.assertIsNone(dead_book_reason({"yes_depth": 0, "no_depth": 0, "has_size": False}, "UP", 50))
        self.assertIsNone(dead_book_reason(None, "UP", 50))

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


class ZachBarTests(unittest.TestCase):
    def test_playable_band_stays_20_80_not_45_55(self):
        self.assertTrue(playable_yes_mid(25))
        self.assertTrue(playable_yes_mid(75))
        self.assertTrue(playable_yes_mid(50))
        self.assertFalse(playable_yes_mid(12))
        self.assertFalse(playable_yes_mid(91))
        # leftover at 25¢ / 75¢ is enough — do not require 45–55
        self.assertIsNone(zach_bar_reason(25, 75, p_finish=0.62, fee_cents=1.0, yes_mid=25, side_ask=25))
        self.assertIsNone(zach_bar_reason(75, 25, p_finish=0.85, fee_cents=1.0, yes_mid=75, side_ask=75))
        self.assertTrue(zach_band_skips_preferred(25, 10.0))
        self.assertTrue(zach_band_skips_preferred(75, 5.0))
        self.assertFalse(zach_band_skips_preferred(25, 0.0))
        self.assertFalse(zach_band_skips_preferred(12, 20.0))

    def test_leftover_required_at_the_ask(self):
        self.assertGreater(leftover_after_vig(0.62, 25.0, fee_cents=1.0), 0.0)
        self.assertLess(leftover_after_vig(0.55, 75.0, fee_cents=1.0), 0.0)
        why = zach_bar_reason(75, 25, p_finish=0.55, fee_cents=1.0, yes_mid=75, side_ask=75)
        self.assertIn("leftover", why or "")

    def test_n0_until_1062_1063_settle(self):
        opens = [
            {"id": 1062, "ticker": "KXBTCD-26AUG1415-T62999.99"},
            {"id": 1063, "ticker": "KXETHD-26AUG1415-T1874.99"},
        ]
        self.assertTrue(stuck_hours_open(opens))
        self.assertEqual(lifetime_n_for_zach(80, opens), 0)
        self.assertEqual(lifetime_n_for_zach(80, []), 80)
        self.assertEqual(eth_settled_n_for_zach(12, opens), 0)
        self.assertEqual(eth_settled_n_for_zach(12, [{"id": 1062, "ticker": "KXBTCD-26AUG1415-T62999.99"}]), 12)

    def test_chair_conf_does_not_size(self):
        self.assertEqual(paper_stake_for_lock("UP", 0, 91), paper_stake_for_lock("UP", 0, 50))
        self.assertEqual(paper_stake_for_lock("UP", 0, 91), 25.0)
        self.assertEqual(paper_stake_for_lock("UP", 80, 91), 25.0)
        self.assertEqual(paper_stake_for_lock("UP_HOLD", 0, 91), 10.0)

    def test_eth_paper_lock_needs_reliability_bin(self):
        self.assertIsNotNone(eth_paper_lock_blocked("ETH", 0))
        self.assertIsNotNone(eth_paper_lock_blocked("ETH", 7))
        self.assertIsNone(eth_paper_lock_blocked("ETH", 8))
        self.assertIsNone(eth_paper_lock_blocked("BTC", 0))
        # veto still independent of the reliability bin
        lead = {"direction": "UP", "impulse": True, "locked": True}
        self.assertTrue(eth_fades_btc_impulse("DOWN", lead))

    def test_eth_shadow_pick_does_not_count_or_size(self):
        pick = eth_shadow_pick(
            "ETH",
            "DOWN",
            71,
            ask=44,
            strike=1874.99,
            ticker="KXETHD-26AUG1516-T1874.99",
        )
        self.assertIsNotNone(pick)
        self.assertEqual(pick["kind"], "eth_shadow")
        self.assertEqual(pick["side"], "DOWN")
        self.assertEqual(pick["confidence"], 71)
        self.assertEqual(pick["ask"], 44)
        self.assertEqual(pick["strike"], 1874.99)
        self.assertEqual(pick["paper_stake"], 0.0)
        self.assertFalse(pick["counts_as_lock"])
        self.assertFalse(pick["vetoed"])
        self.assertIsNone(eth_shadow_pick("BTC", "UP", 80, ask=50, strike=63000))
        self.assertIsNone(eth_shadow_pick("ETH", "WAIT", 70))
        vetoed = eth_shadow_pick("ETH", "UP", 68, ask=51, strike=2000, vetoed=True)
        self.assertTrue(vetoed["vetoed"])
        self.assertTrue(is_eth_shadow_row({"shadow": 1, "direction": "UP"}))
        self.assertTrue(is_eth_shadow_row({"kind": "eth_shadow"}))
        self.assertFalse(is_eth_shadow_row({"direction": "UP", "shadow": 0}))

    def test_floor_scorecard_is_matchup_not_stats_dump(self):
        sc = floor_scorecard(
            {"correct": 4, "wrong": 2, "total": 6},
            {"correct": 9, "wrong": 1, "total": 10, "eth_shadow": {"n": 5, "hits": 3, "wrong": 2}},
        )
        self.assertTrue(sc["paper"])
        self.assertEqual(sc["btc"]["correct"], 4)
        self.assertEqual(sc["btc"]["wrong"], 2)
        self.assertEqual(sc["eth"]["correct"], 3)
        self.assertEqual(sc["eth"]["wrong"], 2)
        self.assertEqual(sc["ahead"], "btc")
        self.assertEqual(sc["kind"], "books")
        self.assertEqual(sc["match"], "BTC 4 · ETH 3")
        self.assertEqual(sc["btc_text"], "BTC 4–2")
        self.assertEqual(sc["eth_text"], "3–2 ETH")
        self.assertNotIn("accuracy_pct", sc)
        blob = " ".join(str(v) for v in sc.values())
        self.assertNotIn("Satoshi", blob)
        self.assertNotIn("Vitalik", blob)
        self.assertNotIn("SATOSHI", blob)
        self.assertNotIn("VITALIK", blob)
        self.assertNotIn("LEADS", blob)
        tied = floor_scorecard(
            {"correct": 2, "wrong": 1},
            {"eth_shadow": {"n": 4, "hits": 2}},
        )
        self.assertEqual(tied["ahead"], "tied")
        self.assertEqual(tied["match"], "BTC 2 · ETH 2")
        self.assertNotIn("LEADS", tied["match"])
        empty = floor_scorecard({}, {})
        self.assertEqual(empty["btc_text"], "BTC 0–0")
        self.assertEqual(empty["eth_text"], "0–0 ETH")
        self.assertEqual(empty["match"], "BTC 0 · ETH 0")

    def test_never_lock_99_or_one_sided_100(self):
        self.assertIn("≥99", never_lock_near_certain(99, 1) or "")
        self.assertIn("≥99", never_lock_near_certain(1, 99) or "")
        self.assertIsNotNone(never_lock_near_certain(100, None))
        self.assertIsNotNone(never_lock_near_certain(None, 100))
        self.assertIsNotNone(never_lock_near_certain(side_odds=99.5))
        self.assertIsNone(never_lock_near_certain(52, 48, side_odds=52))


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
