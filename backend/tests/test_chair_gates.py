"""Paper-only Chair gate math. No network, no live Kalshi orders."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from backend.agents.chair_gates import (
    band_tighten,
    book_is_unknown,
    book_too_thin,
    clamp_p_finish,
    count_paper_locks_today,
    close_time_from_kalshi_ticker,
    collect_official_results,
    compute_ev_cents,
    decide_open_lock_grade,
    dead_book_reason,
    early_lock_blocked,
    estimate_p_finish,
    eth_fades_btc_impulse,
    eth_paper_lock_blocked,
    eth_shadow_pick,
    ev_gate_blocks,
    explore_paper_lock_ok,
    explore_paper_lock_open,
    finish_outcome,
    known_official_market,
    kalshi_result_to_side,
    kalshi_taker_fee_cents,
    event_ticker_from_kalshi_ticker,
    kalshi_market_finalized,
    leftover_after_vig,
    lifetime_n_for_zach,
    lock_time_strike,
    official_y_finish,
    late_spot_decisive,
    never_lock_near_certain,
    official_window_due,
    paper_lock_day_ok,
    paper_stake_for_lock,
    pick_settle_spot,
    odds_band_key,
    parse_book_depth,
    playable_yes_mid,
    resolve_finish_side,
    stuck_hours_open,
    strike_from_kalshi_ticker,
    tape_backfill_stats,
    ticker_asset,
    time_ev_hurdles,
    build_btc_lead,
    zach_bar_reason,
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
        # 90%+ bin stays faded until that bin has enough actually settled hours
        faded = estimate_p_finish(91, 80, bin_settled_n=0)
        self.assertLessEqual(faded, 0.62)

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

    def test_orderbook_fp_dollars_has_size(self):
        book = {
            "orderbook_fp": {
                "yes_dollars": [["0.48", "20.00"], ["0.47", "10.00"]],
                "no_dollars": [["0.51", "15.00"]],
            }
        }
        d = parse_book_depth(book)
        self.assertTrue(d["has_size"])
        self.assertTrue(d["measured"])
        self.assertEqual(d["book_state"], "ok")
        self.assertGreaterEqual(d["yes_depth"], 20)
        self.assertFalse(book_is_unknown(d))

    def test_null_depth_is_unknown_not_dead(self):
        unknown = parse_book_depth(None)
        self.assertEqual(unknown["book_state"], "unknown")
        self.assertTrue(book_is_unknown(unknown))
        self.assertIsNone(dead_book_reason(unknown, "UP", 50))
        both_zero = {"yes_depth": 0, "no_depth": 0, "has_size": False}
        self.assertTrue(book_is_unknown(both_zero))
        self.assertIsNone(dead_book_reason(both_zero, "UP", 50))
        self.assertIsNone(dead_book_reason({"yes_depth": None, "no_depth": None, "has_size": False}, "DOWN", 48))

    def test_measured_one_sided_is_dead(self):
        depth = {"yes_depth": 0, "no_depth": 40, "yes_bid_px": 50, "no_bid_px": 50, "has_size": True, "measured": True}
        why = dead_book_reason(depth, "UP", 50)
        self.assertEqual(why, "one-sided book · yes_depth 0")
        empty = parse_book_depth({"yes": [], "no": []})
        self.assertTrue(empty["measured"])
        self.assertEqual(empty["book_state"], "dead")
        self.assertIn("empty book", dead_book_reason(empty, "UP", 50) or "")


class WindowStrikeTests(unittest.TestCase):
    def test_official_close_only(self):
        now = datetime(2026, 8, 14, 21, 0, tzinfo=timezone.utc)
        close = (now - timedelta(minutes=1)).isoformat()
        future = (now + timedelta(minutes=10)).isoformat()
        self.assertTrue(official_window_due(close, now=now))
        self.assertFalse(official_window_due(future, now=now))
        self.assertFalse(official_window_due(None, now=now))
        self.assertFalse(official_window_due("not-a-time", now=now))
        # 1062/1063: 15:00 ET = 19:00 UTC. Still open at 21:17 must be due via ticker.
        ticker = "KXBTCD-26AUG1415-T62999.99"
        late = datetime(2026, 8, 14, 21, 17, tzinfo=timezone.utc)
        self.assertTrue(official_window_due(None, now=late, ticker=ticker))
        self.assertFalse(official_window_due(None, now=datetime(2026, 8, 14, 18, 0, tzinfo=timezone.utc), ticker=ticker))

    def test_ticker_close_and_strike(self):
        ticker = "KXETHD-26AUG1415-T1874.99"
        ct = close_time_from_kalshi_ticker(ticker)
        self.assertIsNotNone(ct)
        self.assertEqual(ct.astimezone(timezone.utc).hour, 19)
        self.assertEqual(strike_from_kalshi_ticker(ticker), 1874.99)
        self.assertEqual(ticker_asset(ticker), "eth")
        self.assertEqual(ticker_asset("KXBTCD-26AUG1415-T62999.99"), "btc")
        # 1062/1063 had null floor_strike — ticker still has the lock-time strike
        self.assertEqual(lock_time_strike(ticker="KXBTCD-26AUG1415-T62999.99"), 62999.99)
        self.assertEqual(lock_time_strike(ticker="KXETHD-26AUG1415-T1874.99"), 1874.99)
        self.assertEqual(lock_time_strike(floor_strike=64000, ticker="KXBTCD-26AUG1415-T62999.99"), 64000.0)
        self.assertEqual(lock_time_strike(cap_strike=1875, ticker="KXETHD-26AUG1415-T1874.99"), 1875.0)
        self.assertIsNone(lock_time_strike(ticker="KXBTCD-NOSTRIKE"))

    def test_official_y_finish_only_from_kalshi_result(self):
        self.assertEqual(kalshi_result_to_side("yes"), "UP")
        self.assertEqual(kalshi_result_to_side({"result": "no"}), "DOWN")
        self.assertEqual(official_y_finish({"status": "finalized", "result": "no"}), "DOWN")
        self.assertEqual(official_y_finish({"status": "finalized", "result": "yes"}), "UP")
        self.assertIsNone(official_y_finish({"status": "active", "result": "no"}))
        # Later-hour spot must not invent y_finish
        self.assertIsNone(official_y_finish(None))
        self.assertIsNone(resolve_finish_side(spot=63050, locked_strike=62999.99, kalshi_result=None))
        # 1062 / 1063 documented official finishes
        btc = known_official_market("KXBTCD-26AUG1415-T62999.99", 1062)
        eth = known_official_market("KXETHD-26AUG1415-T1874.99", 1063)
        self.assertEqual(official_y_finish(btc), "DOWN")
        self.assertEqual(official_y_finish(eth), "DOWN")
        self.assertEqual(resolve_finish_side(ticker="KXBTCD-26AUG1415-T62999.99"), "DOWN")
        # id 1062 with a different ticker must not apply
        self.assertIsNone(known_official_market("KXBTCD-OTHER", 1062))

    def test_live_1062_1063_grade_after_19utc_close(self):
        """Live stuck OPEN rows: null strike, hour already closed, official no."""
        after = datetime(2026, 8, 14, 21, 17, tzinfo=timezone.utc)
        before = datetime(2026, 8, 14, 18, 50, tzinfo=timezone.utc)
        btc = decide_open_lock_grade(
            ticker="KXBTCD-26AUG1415-T62999.99",
            call_id=1062,
            close_time="2026-08-14T19:00:00Z",
            direction="DOWN",
            now=after,
        )
        self.assertIsNotNone(btc)
        self.assertEqual(btc["y_finish"], "DOWN")
        self.assertTrue(btc["correct"])
        self.assertEqual(btc["settle_reason"], "finish_match")
        self.assertEqual(btc["asset"], "btc")
        self.assertEqual(btc["floor_strike"], 62999.99)
        eth = decide_open_lock_grade(
            ticker="KXETHD-26AUG1415-T1874.99",
            call_id=1063,
            close_time="2026-08-14T19:00:00Z",
            direction="UP",
            now=after,
        )
        self.assertIsNotNone(eth)
        self.assertEqual(eth["y_finish"], "DOWN")
        self.assertFalse(eth["correct"])
        self.assertEqual(eth["settle_reason"], "finish_miss")
        self.assertEqual(eth["asset"], "eth")
        self.assertIsNone(decide_open_lock_grade(
            ticker="KXBTCD-26AUG1415-T62999.99",
            call_id=1062,
            close_time="2026-08-14T19:00:00Z",
            direction="DOWN",
            now=before,
        ))
        # Later-hour spot must not be a closer — no spot argument exists.
        self.assertIsNone(decide_open_lock_grade(
            ticker="KXBTCD-26AUG9999-T1",
            call_id=1,
            close_time="2026-08-14T19:00:00Z",
            direction="DOWN",
            kalshi_result={"status": "active"},
            now=after,
        ))

    def test_finalized_tape_grades_without_known_ids(self):
        """Every finalized paper hour — not just 1062/1063. No guessed side."""
        live = {
            "ticker": "KXBTCD-26AUG1000-T60000.00",
            "status": "finalized",
            "result": "yes",
        }
        self.assertTrue(kalshi_market_finalized(live))
        grade = decide_open_lock_grade(
            ticker="KXBTCD-26AUG1000-T60000.00",
            call_id=44,
            close_time=None,
            direction="UP",
            kalshi_result=live,
        )
        self.assertIsNotNone(grade)
        self.assertEqual(grade["y_finish"], "UP")
        self.assertTrue(grade["correct"])
        no_guess = decide_open_lock_grade(
            ticker="KXBTCD-26AUG1000-T60000.00",
            call_id=44,
            close_time=None,
            direction="UP",
            kalshi_result=None,
        )
        self.assertIsNone(no_guess)
        still_open = decide_open_lock_grade(
            ticker="KXBTCD-26AUG1000-T60000.00",
            call_id=44,
            close_time=None,
            direction="UP",
            kalshi_result={"ticker": "KXBTCD-26AUG1000-T60000.00", "status": "active", "result": "yes"},
        )
        self.assertIsNone(still_open)

    def test_event_payload_collects_every_finalized_strike(self):
        self.assertEqual(
            event_ticker_from_kalshi_ticker("KXBTCD-26AUG1415-T62999.99"),
            "KXBTCD-26AUG1415",
        )
        body = {
            "event": {"event_ticker": "KXBTCD-26AUG1000", "status": "determined"},
            "markets": [
                {"ticker": "KXBTCD-26AUG1000-T60000.00", "status": "finalized", "result": "yes"},
                {"ticker": "KXBTCD-26AUG1000-T61000.00", "status": "finalized", "result": "no"},
                {"ticker": "KXBTCD-26AUG1000-T62000.00", "status": "active"},
            ],
        }
        pulled = collect_official_results(body)
        self.assertEqual(official_y_finish(pulled["KXBTCD-26AUG1000-T60000.00"]), "UP")
        self.assertEqual(official_y_finish(pulled["KXBTCD-26AUG1000-T61000.00"]), "DOWN")
        self.assertNotIn("KXBTCD-26AUG1000-T62000.00", pulled)
        stats = tape_backfill_stats(
            [
                {"id": 1, "ticker": "KXBTCD-26AUG1000-T60000.00"},
                {"id": 2, "ticker": "KXBTCD-26AUG1000-T61000.00"},
                {"id": 3, "ticker": "KXBTCD-26AUG1000-T62000.00"},
            ],
            pulled,
        )
        self.assertEqual(stats["open_n"], 3)
        self.assertEqual(stats["unique_tickers"], 3)
        self.assertEqual(stats["finalized_tickers"], 2)

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
        self.assertEqual(lc["leftover_after_vig"], 19.0)
        self.assertTrue(lc["paper_only"])
        self.assertEqual(lc["floor_strike"], 100000.0)

    def test_stuck_open_forces_n0_p_finish(self):
        chair = Leader()
        chair.edge["total"] = 80
        warm = chair._price_edge(
            70, "UP", 50.0,
            {"spread_cents": 4.0, "mins_left": 30, "window_minutes": 60, "settled_n": 80},
        )
        cold = chair._price_edge(
            70, "UP", 50.0,
            {
                "spread_cents": 4.0,
                "mins_left": 30,
                "window_minutes": 60,
                "settled_n": 80,
                "stuck_open": True,
                "open_rows": [{"id": 1062, "ticker": "KXBTCD-26AUG1415-T62999.99"}],
            },
        )
        self.assertLessEqual(cold["p_finish"], 0.62)
        self.assertLess(cold["p_finish"], warm["p_finish"])
        self.assertEqual(lifetime_n_for_zach(80, [{"id": 1063}]), 0)

    def test_zach_leftover_matches_ask_ev(self):
        self.assertAlmostEqual(
            leftover_after_vig(0.70, 50.0, 4.0),
            compute_ev_cents(0.70, 50.0, 4.0),
        )
        self.assertIsNone(zach_bar_reason(25, 75, p_finish=0.62, fee_cents=1.0, yes_mid=25, side_ask=25))
        self.assertIsNotNone(never_lock_near_certain(99, 1))
        self.assertIsNotNone(eth_paper_lock_blocked("ETH", 0))
        self.assertEqual(paper_stake_for_lock("DOWN", 0, 91), 25.0)
        self.assertFalse(stuck_hours_open([]))


class EthShadowPickTests(unittest.TestCase):
    def _signals(self, side: str):
        from backend.agents.base import AgentSignal
        names = (
            "candle", "volume", "momentum", "orderflow", "odds", "strike",
            "quorum", "cheap", "panic", "spotlag", "exhaust", "whale",
        )
        return [
            AgentSignal(n, side, 82, "test", n)
            for n in names
        ]

    def _eth_regime(self, **over):
        base = {
            "asset": "eth",
            "ticker": "KXETHD-26AUG1516-T2000.00",
            "mins_left": 35,
            "window_minutes": 60,
            "up_pct": 48,
            "yes_ask": 50,
            "no_ask": 52,
            "yes_mid": 48,
            "floor_strike": 2000.0,
            "kalshi_healthy": True,
            "eth_settled_n": 0,
            "settled_n": 0,
            "spread_cents": 2.0,
        }
        base.update(over)
        return base

    def test_eth_wait_still_writes_shadow_pick(self):
        chair = Leader()
        out = chair.synthesize(self._signals("UP"), self._eth_regime())
        self.assertEqual(out["direction"], "WAIT")
        self.assertFalse(out.get("window_locked"))
        self.assertFalse((out.get("locked_call") or {}).get("locked"))
        pick = out.get("eth_shadow_pick")
        self.assertIsNotNone(pick)
        self.assertEqual(pick["side"], "UP")
        self.assertEqual(pick["paper_stake"], 0.0)
        self.assertFalse(pick["counts_as_lock"])
        self.assertEqual(pick["strike"], 2000.0)
        self.assertEqual(pick["ask"], 50)
        self.assertFalse(pick["vetoed"])

    def test_btc_impulse_veto_still_records_eth_shadow(self):
        chair = Leader()
        out = chair.synthesize(
            self._signals("DOWN"),
            self._eth_regime(btc_lead={"direction": "UP", "impulse": True, "locked": True}),
        )
        self.assertEqual(out["direction"], "WAIT")
        pick = out.get("eth_shadow_pick")
        self.assertIsNotNone(pick)
        self.assertEqual(pick["side"], "DOWN")
        self.assertTrue(pick["vetoed"])
        self.assertEqual(pick["paper_stake"], 0.0)
        self.assertFalse(pick["counts_as_lock"])

    def test_btc_does_not_write_eth_shadow(self):
        chair = Leader()
        out = chair.synthesize(
            self._signals("UP"),
            self._eth_regime(asset="btc", ticker="KXBTCD-26AUG1516-T63000.00", floor_strike=63000.0),
        )
        self.assertIsNone(out.get("eth_shadow_pick"))
        self.assertIsNone(eth_shadow_pick("btc", "UP", 80))


class ExplorePaperLockTests(unittest.TestCase):
    def _book(self):
        return {
            "yes_depth": 40,
            "no_depth": 30,
            "yes_bid_sz": 20,
            "no_bid_sz": 15,
            "yes_bid_px": 48,
            "no_bid_px": 51,
            "has_size": True,
            "measured": True,
            "book_state": "ok",
        }

    def _btc_regime(self, **over):
        base = {
            "asset": "btc",
            "ticker": "KXBTCD-26AUG1616-T63000.00",
            "mins_left": 35,
            "window_minutes": 60,
            "up_pct": 48,
            "yes_ask": 50,
            "no_ask": 52,
            "yes_mid": 48,
            "side_ask": 50,
            "floor_strike": 63000.0,
            "kalshi_healthy": True,
            "settled_n": 3,
            "reliability_n": 3,
            "learning_phase": "explore",
            "spread_cents": 2.0,
            "book_depth": self._book(),
            "paper_locks_today": 0,
        }
        base.update(over)
        return base

    def _mixed_signals(self):
        from backend.agents.base import AgentSignal
        return [
            AgentSignal("candle", "UP", 80, "test", "candle"),
            AgentSignal("strike", "DOWN", 80, "test", "strike"),
            AgentSignal("odds", "UP", 78, "test", "odds"),
            AgentSignal("whale", "DOWN", 70, "test", "whale"),
            AgentSignal("volume", "UP", 72, "test", "volume"),
            AgentSignal("momentum", "WAIT", 40, "test", "momentum"),
        ]

    def test_explore_helpers(self):
        self.assertTrue(explore_paper_lock_open("explore", 3))
        self.assertTrue(explore_paper_lock_open("calibrate", 12))
        self.assertFalse(explore_paper_lock_open("calibrate", 20))
        self.assertFalse(explore_paper_lock_open("exploit", 80))
        self.assertTrue(explore_paper_lock_ok(0.62, 2.0, 48))
        self.assertFalse(explore_paper_lock_ok(0.50, 4.0, 48))
        self.assertFalse(explore_paper_lock_ok(0.62, -1.0, 48))
        self.assertFalse(explore_paper_lock_ok(0.62, 2.0, 12))
        self.assertTrue(paper_lock_day_ok(0, 5))
        self.assertTrue(paper_lock_day_ok(4, 5))
        self.assertFalse(paper_lock_day_ok(5, 5))
        today = datetime(2026, 8, 16, 18, 0, tzinfo=timezone.utc)
        n = count_paper_locks_today(
            [
                {"direction": "UP", "called_at": "2026-08-16T16:10:00+00:00", "asset": "btc"},
                {"direction": "WAIT", "called_at": "2026-08-16T17:10:00+00:00", "asset": "btc"},
                {"direction": "DOWN", "called_at": "2026-08-15T16:10:00+00:00", "asset": "btc"},
            ],
            now=today,
            asset="btc",
        )
        self.assertEqual(n, 1)

    def test_explore_paper_locks_without_four_category_confluence(self):
        chair = Leader()
        chair.update_edge_from_accuracy({"total": 3, "reliability_n": 3, "verdict": "COLLECTING"})
        out = chair.synthesize(self._mixed_signals(), self._btc_regime())
        self.assertIn(out["direction"], ("UP", "DOWN", "UP_HOLD", "DOWN_HOLD"))
        self.assertTrue(out.get("window_locked") or (out.get("locked_call") or {}).get("locked"))
        self.assertTrue(out.get("explore_paper"))
        self.assertTrue(out.get("paper_only"))
        self.assertIn("PAPER", out.get("summary") or "")
        self.assertNotIn("dead book", (out.get("summary") or "").lower())

    def test_unknown_book_is_not_dead_book_wait(self):
        chair = Leader()
        chair.update_edge_from_accuracy({"total": 3, "reliability_n": 3, "verdict": "COLLECTING"})
        out = chair.synthesize(
            self._mixed_signals(),
            self._btc_regime(book_depth={"yes_depth": 0, "no_depth": 0, "has_size": False}),
        )
        self.assertNotIn("dead book", (out.get("summary") or "").lower())
        self.assertTrue(out.get("explore_paper"))

    def test_measured_99_wall_still_waits(self):
        chair = Leader()
        chair.update_edge_from_accuracy({"total": 3, "reliability_n": 3, "verdict": "COLLECTING"})
        out = chair.synthesize(
            self._mixed_signals(),
            self._btc_regime(yes_ask=99, no_ask=1, up_pct=99, yes_mid=99, side_ask=99),
        )
        self.assertEqual(out["direction"], "WAIT")
        self.assertFalse(out.get("window_locked"))

    def test_eth_explore_still_gated(self):
        chair = Leader()
        chair.update_edge_from_accuracy({"total": 3, "reliability_n": 3, "verdict": "COLLECTING"})
        out = chair.synthesize(
            self._mixed_signals(),
            self._btc_regime(
                asset="eth",
                ticker="KXETHD-26AUG1616-T2000.00",
                floor_strike=2000.0,
                eth_settled_n=0,
            ),
        )
        self.assertEqual(out["direction"], "WAIT")
        self.assertFalse(out.get("window_locked"))
        self.assertIn("ETH", out.get("summary") or "")

    def test_calibrated_path_keeps_confluence_gate(self):
        chair = Leader()
        chair.update_edge_from_accuracy({
            "total": 25,
            "reliability_n": 25,
            "accuracy_pct": 52,
            "verdict": "OK",
        })
        out = chair.synthesize(
            self._mixed_signals(),
            self._btc_regime(reliability_n=25, learning_phase="calibrate", settled_n=25),
        )
        # Live / calibrate still needs confluence — do not force a paper lock.
        if out.get("explore_paper"):
            self.fail("explore paper path must stay off when reliability_n >= 20")


if __name__ == "__main__":
    unittest.main()
