"""BTC 15m full retrain — not a 1H clock change. ETH stays 1H."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from backend.agents.candle import BitcoinPatternSpecialist, EthereumPatternSpecialist
from backend.agents.chair_gates import (
    can_final_lock,
    classify_wait_reason,
    close_time_from_kalshi_ticker,
    dead_book_reason,
    early_lock_blocked,
    estimate_p_finish,
    event_ticker_from_kalshi_ticker,
    floor_scorecard,
    official_y_finish,
    playable_band_cents,
    playable_yes_mid,
)
from backend.agents.window_memory import WindowMemory
from backend.config import settings
from backend.data.kalshi import pick_hour_book
from backend.learning.adaptive import AdaptiveLearner
from backend.learning.btc15m import (
    BRAIN_FILE_BTC_15M,
    EARLY_NO_LOCK_MINS_15M,
    SCORE_BAND_HI,
    SCORE_BAND_LO,
    SERIES_BTC_15M,
    SERIES_ETH_1H,
    close_time_from_15m_ticker,
    coinglass_allowed_on_book,
    early_no_lock_mins_for,
    event_ticker_from_15m,
    is_btc_15m_ticker,
    learner_brain_tag,
    paper_lock_score_skip,
    playable_band_cents_for,
    series_for_live_asset,
    timeframe_gates,
    window_label,
    window_minutes_for,
)
from backend.learning.seat_backfill_15m import (
    backfill_15m_contract,
    filter_15m_votes,
    grade_one_15m,
    run_btc_15m_backfill,
)
from backend.storage.db import PerformanceStore, WindowCall

ROOT = Path(__file__).resolve().parents[2]
ET = ZoneInfo("America/New_York")
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
WIRE = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
CFG = (ROOT / "backend" / "config.py").read_text(encoding="utf-8")
DUAL = (ROOT / "backend" / "services" / "dual.py").read_text(encoding="utf-8")
SB1H = (ROOT / "backend" / "learning" / "seat_backfill.py").read_text(encoding="utf-8")


def _row(
    *,
    ticker: str,
    asset: str,
    correct: int | None,
    direction: str = "UP",
    open_price: float = 48.0,
    settle_reason: str | None = None,
    paper_pnl: float | None = None,
    when: str = "2026-08-16T16:00:00+00:00",
) -> WindowCall:
    hit = correct == 1
    fifteen = str(ticker).upper().startswith("KXBTC15M")
    if settle_reason is None:
        if fifteen:
            settle_reason = "path_pnl" if correct is not None else "chalk_skip"
        else:
            settle_reason = "finish_match" if hit else "finish_miss"
    if paper_pnl is None:
        if fifteen and settle_reason == "path_pnl":
            paper_pnl = 12.0 if hit else -10.0
        else:
            paper_pnl = 0.0
    return WindowCall(
        ticker=ticker,
        direction=direction,
        confidence=70,
        called_at=when,
        settled_at=when,
        actual_outcome="PATH" if fifteen and settle_reason.startswith("path_") else (
            "UP" if (direction == "UP") == hit else "DOWN"
        ),
        y_finish="UP" if (direction == "UP") == hit else "DOWN",
        correct=None if fifteen else correct,
        settle_reason=settle_reason,
        paper_stake=10.0,
        paper_pnl=paper_pnl,
        asset=asset,
        shadow=0,
        open_price=open_price,
    )


class SplitAndSeriesTests(unittest.TestCase):
    def test_live_series_split(self):
        self.assertEqual(settings.SERIES_BTC, SERIES_BTC_15M)
        self.assertEqual(settings.SERIES_ETH, SERIES_ETH_1H)
        self.assertEqual(settings.SERIES_BTC_1H, "KXBTCD")
        self.assertEqual(series_for_live_asset("btc"), "KXBTC15M")
        self.assertEqual(series_for_live_asset("eth"), "KXETHD")
        self.assertNotIn("KXETH15M", settings.SERIES_ETH)
        self.assertIn('SERIES_ETH: str = "KXETHD"', CFG)
        self.assertIn("Do not start KXETH15M", CFG)

    def test_ticker_parse_15m(self):
        tick = "KXBTC15M-26AUG161200-00"
        self.assertTrue(is_btc_15m_ticker(tick))
        self.assertEqual(event_ticker_from_15m(tick), "KXBTC15M-26AUG161200")
        self.assertEqual(event_ticker_from_kalshi_ticker(tick), "KXBTC15M-26AUG161200")
        ct = close_time_from_15m_ticker(tick)
        self.assertIsNotNone(ct)
        self.assertEqual(close_time_from_kalshi_ticker(tick), ct)
        local = ct.astimezone(ET)
        self.assertEqual(local.year, 2026)
        self.assertEqual(local.month, 8)
        self.assertEqual(local.day, 16)
        self.assertEqual(local.hour, 12)
        self.assertEqual(local.minute, 0)
        self.assertEqual(official_y_finish({"status": "settled", "result": "yes"}), "UP")
        self.assertEqual(official_y_finish({"status": "settled", "result": "no"}), "DOWN")
        # Live Kalshi suffix is the close minute (e.g. -15), not a 1H -T strike.
        live = "KXBTC15M-26AUG161215-15"
        self.assertEqual(event_ticker_from_15m(live), "KXBTC15M-26AUG161215")
        live_ct = close_time_from_15m_ticker(live)
        self.assertIsNotNone(live_ct)
        self.assertEqual(live_ct.astimezone(ET).hour, 12)
        self.assertEqual(live_ct.astimezone(ET).minute, 15)
        self.assertEqual(official_y_finish({"status": "finalized", "result": "yes"}), "UP")

    def test_path_pnl_save_replaces_finish_era_brain(self):
        with tempfile.TemporaryDirectory() as td:
            with patch.object(settings, "DATA_DIR", td):
                path = Path(td) / "council-learning-btc15m.json"
                path.write_text(
                    json.dumps({
                        "updates": 6346,
                        "weights": {"candle_btc": 0.2},
                        "backfill": {"tag": "backfill_15m", "windows_graded": 6330},
                    }),
                    encoding="utf-8",
                )
                brain = AdaptiveLearner(asset="btc")
                brain.updates = 12
                brain.backfill = {"tag": "backfill_15m", "score": "realized_paper_pnl", "windows_graded": 12}
                brain.save(path)
                saved = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(saved["updates"], 12)
                self.assertEqual(saved["backfill"]["score"], "realized_paper_pnl")
                path.write_text(
                    json.dumps({
                        "updates": 6346,
                        "weights": {"candle_btc": 0.2},
                        "backfill": {"tag": "backfill_15m", "score": "realized_paper_pnl", "windows_graded": 16},
                    }),
                    encoding="utf-8",
                )
                brain.updates = 20
                brain.save(path)
                saved = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(saved["updates"], 20)

    def test_brains_are_separate(self):
        self.assertEqual(learner_brain_tag("btc"), "btc15m")
        self.assertEqual(learner_brain_tag("eth"), "eth")
        self.assertEqual(BRAIN_FILE_BTC_15M, "council-learning-btc15m.json")
        self.assertNotEqual(learner_brain_tag("btc"), "btc")
        with tempfile.TemporaryDirectory() as td:
            with patch.object(settings, "DATA_DIR", td):
                btc = AdaptiveLearner(asset="btc")
                eth = AdaptiveLearner(asset="eth")
                btc.updates = 3
                eth.updates = 5
                btc.save()
                eth.save()
                root = Path(td)
                self.assertTrue((root / "council-learning-btc15m.json").is_file())
                self.assertTrue((root / "council-learning-eth.json").is_file())
                self.assertFalse((root / "council-learning-btc.json").is_file())

    def test_coinglass_off_15m_on_eth_1h(self):
        self.assertFalse(coinglass_allowed_on_book(ticker="KXBTC15M-26AUG161200-00", asset="btc"))
        self.assertFalse(coinglass_allowed_on_book(series="KXBTC15M", asset="btc"))
        self.assertTrue(coinglass_allowed_on_book(ticker="KXETHD-26AUG1615-T2400", asset="eth"))
        self.assertIn("Do not merge KXBTCD hours into council-learning-btc15m", SB1H)
        self.assertIn("maybe_run_boot_backfill_15m", DUAL)


class SitAndBandTests(unittest.TestCase):
    def test_15m_sit_is_not_first_10m(self):
        self.assertEqual(EARLY_NO_LOCK_MINS_15M, 2.0)
        self.assertEqual(early_no_lock_mins_for(ticker="KXBTC15M-26AUG161200-00", asset="btc"), 2.0)
        self.assertEqual(early_no_lock_mins_for(ticker="KXETHD-26AUG1615-T2400", asset="eth"), 10.0)
        # First 2m of 15m blocked. Minute 3 is open. First 10m of 15m is NOT a sit.
        self.assertTrue(early_lock_blocked(13.5, 15.0, 2.0))   # 1.5m elapsed
        self.assertFalse(early_lock_blocked(13.0, 15.0, 2.0))  # 2m elapsed
        self.assertFalse(early_lock_blocked(5.0, 15.0, 2.0))   # would be blocked if we copied 1H 10m
        # ETH 1H still first 10m
        self.assertTrue(early_lock_blocked(55.0, 60.0, 10.0))
        self.assertFalse(early_lock_blocked(49.0, 60.0, 10.0))
        self.assertEqual(
            classify_wait_reason("WAIT · first 2m of the 15m — no lock"),
            "first_2m",
        )
        self.assertEqual(
            classify_wait_reason("WAIT · first 10m of the hour — no lock"),
            "first_10m",
        )

    def test_band_20_80_on_satoshi_eth_stays_10_90(self):
        self.assertEqual(playable_band_cents_for(ticker="KXBTC15M-26AUG161200-00", asset="btc"), (20.0, 80.0))
        self.assertEqual(playable_band_cents(ticker="KXETHD-26AUG1615-T1", asset="eth"), (10.0, 90.0))
        self.assertTrue(playable_yes_mid(50, ticker="KXBTC15M-26AUG161200-00", asset="btc"))
        self.assertTrue(playable_yes_mid(20, ticker="KXBTC15M-26AUG161200-00", asset="btc"))
        self.assertTrue(playable_yes_mid(80, ticker="KXBTC15M-26AUG161200-00", asset="btc"))
        self.assertFalse(playable_yes_mid(12, ticker="KXBTC15M-26AUG161200-00", asset="btc"))
        self.assertFalse(playable_yes_mid(88, ticker="KXBTC15M-26AUG161200-00", asset="btc"))
        self.assertFalse(playable_yes_mid(19, ticker="KXBTC15M-26AUG161200-00", asset="btc"))
        self.assertFalse(playable_yes_mid(81, ticker="KXBTC15M-26AUG161200-00", asset="btc"))
        self.assertTrue(playable_yes_mid(12, ticker="KXETHD-26AUG1615-T1", asset="eth"))
        self.assertTrue(playable_yes_mid(88, ticker="KXETHD-26AUG1615-T1", asset="eth"))
        # Generic / no-ticker stays 10–90 so ETH + old tests do not shrink
        self.assertTrue(playable_yes_mid(12))
        self.assertTrue(playable_yes_mid(88))

    def test_dead_stack_sits(self):
        chalk = [{
            "ticker": "KXBTC15M-26AUG161200-00",
            "series_ticker": "KXBTC15M",
            "close_time": "2026-08-16T16:00:00Z",
            "yes_bid_dollars": 0.98,
            "yes_ask_dollars": 0.99,
            "no_bid_dollars": 0.01,
            "no_ask_dollars": 0.02,
            "floor_strike": 64000,
            "status": "open",
        }]
        self.assertIsNone(pick_hour_book(chalk, spot=64000, sit_if_dead=True))
        playable = [{
            "ticker": "KXBTC15M-26AUG161215-00",
            "series_ticker": "KXBTC15M",
            "close_time": "2026-08-16T16:15:00Z",
            "yes_bid_dollars": 0.48,
            "yes_ask_dollars": 0.50,
            "no_bid_dollars": 0.49,
            "no_ask_dollars": 0.51,
            "floor_strike": 64000,
            "status": "open",
        }]
        pick = pick_hour_book(playable, spot=64000, sit_if_dead=True)
        self.assertIsNotNone(pick)
        self.assertIn("KXBTC15M", pick["ticker"])
        why = dead_book_reason(None, "UP", 5, ticker="KXBTC15M-26AUG161200-00", asset="btc")
        self.assertIn("20–80", why or "")

    def test_timeframe_gates_split(self):
        btc = timeframe_gates(ticker="KXBTC15M-26AUG161200-00", asset="btc")
        eth = timeframe_gates(ticker="KXETHD-26AUG1615-T1", asset="eth")
        self.assertEqual(btc["window_minutes"], 15.0)
        self.assertEqual(btc["early_no_lock_mins"], 2.0)
        self.assertEqual(btc["late_window_mins"], 2.5)
        self.assertEqual(btc["band_lo"], 20.0)
        self.assertEqual(btc["band_hi"], 80.0)
        self.assertEqual(btc["min_ev"], 0.0)
        self.assertEqual(eth["early_no_lock_mins"], 10.0)
        self.assertEqual(eth["late_window_mins"], 15.0)
        self.assertEqual(window_minutes_for(asset="eth"), 60.0)
        self.assertEqual(window_minutes_for(asset="btc"), 15.0)
        self.assertEqual(window_label(ticker="KXBTC15M-26AUG161200-00"), "15M WINDOW")
        self.assertEqual(window_label(ticker="KXETHD-26AUG1615-T1"), "1H WINDOW")

    def test_window_memory_phases(self):
        wm = WindowMemory()
        wm.on_tick("KXBTC15M-A", 50, 64000, 12.0, window_minutes=15.0)
        self.assertEqual(wm.live.phase, "entry")
        wm.on_tick("KXBTC15M-A", 50, 64000, 8.0, window_minutes=15.0)
        self.assertEqual(wm.live.phase, "mid")
        wm.on_tick("KXBTC15M-A", 50, 64000, 2.0, window_minutes=15.0)
        self.assertEqual(wm.live.phase, "final")
        wm.on_tick("KXETHD-A", 50, 2400, 45.0, window_minutes=60.0)
        self.assertEqual(wm.live.phase, "entry")
        wm.on_tick("KXETHD-A", 50, 2400, 20.0, window_minutes=60.0)
        self.assertEqual(wm.live.phase, "mid")
        wm.on_tick("KXETHD-A", 50, 2400, 10.0, window_minutes=60.0)
        self.assertEqual(wm.live.phase, "final")


class ScoringRuleTests(unittest.TestCase):
    def test_paper_lock_score_skip(self):
        tick = "KXBTC15M-26AUG161200-00"
        self.assertIsNone(paper_lock_score_skip(ticker=tick, open_price=48, direction="UP"))
        self.assertEqual(paper_lock_score_skip(ticker=tick, open_price=99, direction="UP"), "chalk_skip")
        self.assertEqual(paper_lock_score_skip(ticker=tick, open_price=12, direction="UP"), "band_skip")
        self.assertEqual(paper_lock_score_skip(ticker=tick, open_price=88, direction="DOWN"), "band_skip")
        self.assertEqual(paper_lock_score_skip(ticker=tick, open_price=19, direction="UP"), "band_skip")
        self.assertEqual(paper_lock_score_skip(ticker=tick, open_price=81, direction="DOWN"), "band_skip")
        self.assertIsNone(paper_lock_score_skip(ticker=tick, open_price=22, direction="UP"))
        self.assertIsNone(paper_lock_score_skip(ticker=tick, open_price=78, direction="DOWN"))
        self.assertEqual(paper_lock_score_skip(ticker=tick, direction="WAIT"), "wait_skip")
        self.assertEqual(paper_lock_score_skip(ticker=tick, direction="UP"), "no_entry_odds")
        # ETH 1H untouched
        self.assertIsNone(paper_lock_score_skip(ticker="KXETHD-26AUG1615-T2400", open_price=99, direction="UP"))
        self.assertIsNone(paper_lock_score_skip(ticker="KXBTCD-26AUG1615-T63000", open_price=99, direction="UP"))

    def test_confidence_shrinks_until_n(self):
        cold = estimate_p_finish(91, 0)
        self.assertLessEqual(cold, 0.62)
        warm = estimate_p_finish(91, 80)
        self.assertGreater(warm, cold)

    def test_specialist_lookbacks_split(self):
        self.assertEqual(BitcoinPatternSpecialist.lookback, 24)
        self.assertEqual(EthereumPatternSpecialist.lookback, 45)
        self.assertNotEqual(BitcoinPatternSpecialist.ret5_bar, EthereumPatternSpecialist.ret5_bar)

    def test_15m_horizons_are_not_1h(self):
        from backend.agents.momentum import MomentumSpecialist
        from backend.learning.btc15m import CANDLE_LOOKBACK_MIN_15M, exhaust_thresholds_15m, momentum_horizons_15m
        hz = momentum_horizons_15m()
        self.assertEqual(hz["bars"], (3, 8, 15))
        self.assertLess(hz["full_ret"], 0.0015)
        ex = exhaust_thresholds_15m()
        self.assertLess(ex["run_pct"], 0.9)
        self.assertEqual(ex["run_bars"], 15)
        self.assertGreaterEqual(CANDLE_LOOKBACK_MIN_15M, 45)
        mom = MomentumSpecialist()
        bars = []
        px = 100.0
        for i in range(40):
            nxt = px + 0.08
            bars.append({"open": px, "high": nxt + 0.02, "low": px - 0.02, "close": nxt, "volume": 12})
            px = nxt
        md_15 = {
            "asset": "btc",
            "ticker": "KXBTC15M-26AUG161200-00",
            "window_minutes": 15,
            "candles": bars,
            "phase": "entry",
            "wm": {"phase": "entry"},
        }
        md_eth = {
            "asset": "eth",
            "ticker": "KXETHD-26AUG1615-T2400",
            "window_minutes": 60,
            "candles": bars,
            "phase": "entry",
            "wm": {"phase": "entry"},
        }
        import asyncio
        s15 = asyncio.run(mom.get_signal(md_15))
        s1h = asyncio.run(mom.get_signal(md_eth))
        self.assertEqual(s15.features.get("horizon_stack"), "3/8/15")
        self.assertEqual(s1h.features.get("horizon_stack"), "5/15/30")
        self.assertIn("20–80", s15.reasoning)
        self.assertIn("10–90", s1h.reasoning)


class DisplayAndStoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name) / "data"
        self.data.mkdir()
        fd, db_path = tempfile.mkstemp(suffix=".db", dir=self.tmp.name)
        os.close(fd)
        self._patch = patch.multiple(settings, DATA_DIR=str(self.data), DATABASE_URL=f"sqlite+aiosqlite:///{db_path}")
        self._patch.start()
        self.store = PerformanceStore()
        await self.store.init()

    async def asyncTearDown(self):
        await self.store.close()
        self._patch.stop()
        self.tmp.cleanup()

    async def test_1h_btc_hits_hidden_15m_counted_eth_stays(self):
        async with self.store.Session() as session:
            for i in range(5):
                session.add(_row(ticker=f"KXBTCD-26AUG15{10+i:02d}-T63000", asset="btc", correct=1))
            for i in range(3):
                session.add(_row(ticker=f"KXBTCD-26AUG15{20+i:02d}-T63000", asset="btc", correct=0, direction="DOWN"))
            session.add(_row(ticker="KXBTC15M-26AUG161200-00", asset="btc", correct=1, open_price=48))
            session.add(_row(ticker="KXBTC15M-26AUG161215-00", asset="btc", correct=0, direction="DOWN", open_price=52))
            session.add(_row(
                ticker="KXBTC15M-26AUG161230-00", asset="btc", correct=1, open_price=99,
                settle_reason="chalk_skip",
            ))
            session.add(_row(ticker="KXETHD-26AUG1615-T2400", asset="eth", correct=1, open_price=48))
            await session.commit()
        # Force chalk row to not count: settle_reason chalk + correct None
        async with self.store.Session() as session:
            from sqlalchemy import select
            rows = (await session.execute(select(WindowCall))).scalars().all()
            for r in rows:
                if r.open_price == 99:
                    r.correct = None
                    r.settle_reason = "chalk_skip"
            await session.commit()

        btc = await self.store.get_accuracy(asset="btc")
        eth = await self.store.get_accuracy(asset="eth")
        self.assertEqual(btc["correct"], 1)
        self.assertEqual(btc["wrong"], 1)
        self.assertEqual(btc["total"], 2)
        self.assertEqual(eth["correct"], 1)
        self.assertEqual(eth["wrong"], 0)
        sc = floor_scorecard(btc, eth)
        self.assertNotIn("5–3", sc["btc_text"])
        self.assertIn("1–1", sc["btc_text"])

    async def test_old_finish_match_is_not_a_15m_win(self):
        async with self.store.Session() as session:
            session.add(_row(
                ticker="KXBTC15M-26AUG161245-00",
                asset="btc",
                correct=1,
                open_price=48,
                settle_reason="finish_match",
                paper_pnl=12.0,
            ))
            session.add(_row(
                ticker="KXBTC15M-26AUG161300-00",
                asset="btc",
                correct=1,
                open_price=47,
                settle_reason="path_pnl",
                paper_pnl=4.5,
            ))
            await session.commit()
        acc = await self.store.get_accuracy(asset="btc")
        self.assertEqual(acc["total"], 1)
        self.assertEqual(acc["correct"], 1)
        self.assertEqual(acc["wrong"], 0)

    async def test_settle_skips_chalk_and_wait(self):
        async with self.store.Session() as session:
            session.add(WindowCall(
                ticker="KXBTC15M-26AUG101200-00",
                direction="UP",
                confidence=90,
                called_at="2026-08-10T15:50:00+00:00",
                close_time="2026-08-10T16:00:00+00:00",
                open_price=99.0,
                asset="btc",
                paper_stake=10.0,
            ))
            session.add(WindowCall(
                ticker="KXBTC15M-26AUG101215-00",
                direction="WAIT",
                confidence=70,
                called_at="2026-08-10T16:05:00+00:00",
                close_time="2026-08-10T16:15:00+00:00",
                asset="btc",
                paper_stake=0.0,
            ))
            session.add(WindowCall(
                ticker="KXBTC15M-26AUG101230-00",
                direction="UP",
                confidence=62,
                called_at="2026-08-10T16:20:00+00:00",
                close_time="2026-08-10T16:30:00+00:00",
                open_price=48.0,
                asset="btc",
                paper_stake=10.0,
            ))
            await session.commit()
        results = {
            "KXBTC15M-26AUG101200-00": {"ticker": "KXBTC15M-26AUG101200-00", "status": "settled", "result": "yes"},
            "KXBTC15M-26AUG101215-00": {"ticker": "KXBTC15M-26AUG101215-00", "status": "settled", "result": "no"},
            "KXBTC15M-26AUG101230-00": {"ticker": "KXBTC15M-26AUG101230-00", "status": "settled", "result": "yes"},
        }
        n = await self.store.settle_expired_calls(kalshi_results=results, asset="btc")
        self.assertGreaterEqual(n, 3)
        acc = await self.store.get_accuracy(asset="btc")
        self.assertEqual(acc["correct"], 1)
        self.assertEqual(acc["wrong"], 0)
        self.assertEqual(acc["total"], 1)
        async with self.store.Session() as session:
            from sqlalchemy import select
            rows = (await session.execute(select(WindowCall))).scalars().all()
            by_t = {r.ticker: r for r in rows}
            self.assertEqual(by_t["KXBTC15M-26AUG101200-00"].settle_reason, "chalk_skip")
            self.assertIsNone(by_t["KXBTC15M-26AUG101200-00"].correct)
            self.assertEqual(by_t["KXBTC15M-26AUG101215-00"].settle_reason, "wait_finish")
            self.assertIsNone(by_t["KXBTC15M-26AUG101215-00"].correct)
            self.assertEqual(by_t["KXBTC15M-26AUG101230-00"].settle_reason, "path_pnl")
            self.assertIsNone(by_t["KXBTC15M-26AUG101230-00"].correct)
            self.assertGreater(float(by_t["KXBTC15M-26AUG101230-00"].paper_pnl or 0), 0.0)

    async def test_dual_path_fills_hold_both_and_grade_net_pnl(self):
        """One window, both doors open. Official UP is a mark, not the win."""
        tick = "KXBTC15M-26AUG101345-45"
        close = "2026-08-10T17:45:00+00:00"
        await self.store.record_path_fills(
            ticker=tick,
            close_time=close,
            fills=[
                {"fill_kind": "dual_open", "side": "UP", "entry_cents": 42.0, "stake": 10.0},
                {"fill_kind": "dual_open", "side": "DOWN", "entry_cents": 42.0, "stake": 10.0},
            ],
            asset="btc",
        )
        async with self.store.Session() as session:
            from sqlalchemy import select
            open_rows = (await session.execute(
                select(WindowCall).where(WindowCall.ticker == tick)
            )).scalars().all()
        self.assertEqual({r.direction for r in open_rows}, {"UP", "DOWN"})
        self.assertTrue(all(r.actual_outcome is None for r in open_rows))
        self.assertEqual({r.settle_reason for r in open_rows}, {"path_dual"})

        n = await self.store.settle_expired_calls(
            kalshi_results={tick: {"ticker": tick, "status": "settled", "result": "yes"}},
            asset="btc",
        )
        self.assertEqual(n, 2)
        async with self.store.Session() as session:
            from sqlalchemy import select
            rows = (await session.execute(
                select(WindowCall).where(WindowCall.ticker == tick)
            )).scalars().all()
        by_side = {r.direction: r for r in rows}
        self.assertEqual(by_side["UP"].settle_reason, "path_pnl")
        self.assertEqual(by_side["DOWN"].settle_reason, "path_pnl")
        self.assertIsNone(by_side["UP"].correct)
        self.assertIsNone(by_side["DOWN"].correct)
        self.assertGreater(float(by_side["UP"].paper_pnl or 0), 0.0)
        self.assertLess(float(by_side["DOWN"].paper_pnl or 0), 0.0)
        net = float(by_side["UP"].paper_pnl) + float(by_side["DOWN"].paper_pnl)
        self.assertGreater(net, 0.0)

        acc = await self.store.get_accuracy(asset="btc")
        self.assertEqual(acc["total"], 1)
        self.assertEqual(acc["correct"], 1)
        self.assertEqual(acc["wrong"], 0)

    async def test_log_signal_dual_fills_write_both_tickets(self):
        tick = "KXBTC15M-26AUG101330-30"
        await self.store.log_signal(
            {
                "direction": "BOTH",
                "confidence": 64,
                "path_fills": [
                    {"fill_kind": "dual_open", "side": "UP", "entry_cents": 41.0, "stake": 10.0},
                    {"fill_kind": "dual_open", "side": "DOWN", "entry_cents": 44.0, "stake": 10.73},
                ],
            },
            [],
            market_ticker=tick,
            close_time="2026-08-10T17:30:00+00:00",
            asset="btc",
        )
        async with self.store.Session() as session:
            from sqlalchemy import select
            rows = (await session.execute(
                select(WindowCall).where(WindowCall.ticker == tick)
            )).scalars().all()
        self.assertEqual({r.direction for r in rows}, {"UP", "DOWN"})
        self.assertTrue(all(r.actual_outcome is None for r in rows))
        self.assertEqual({r.settle_reason for r in rows}, {"path_dual"})

    async def test_path_fill_logs_sizing_into_paper_journal(self):
        tick = "KXBTC15M-26AUG101500-00"
        sizing = {
            "stake": 12.5,
            "units": 1.25,
            "reason": "conf+edge+dual",
            "is_scalp": False,
            "is_dual_sided": True,
            "clamped": False,
            "raw_stake": 12.5,
        }
        await self.store.record_path_fills(
            ticker=tick,
            close_time="2026-08-10T19:00:00+00:00",
            fills=[
                {"fill_kind": "dual_open", "side": "UP", "entry_cents": 42.0, "stake": 12.5, "sizing": sizing},
                {"fill_kind": "dual_open", "side": "DOWN", "entry_cents": 42.0, "stake": 12.5, "sizing": sizing},
            ],
            asset="btc",
            sizing=sizing,
        )
        journal = await self.store.get_paper_journal()
        rows = [c for c in journal["calls"] if c["ticker"] == tick]
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(isinstance(c.get("sizing"), dict) for c in rows))
        self.assertEqual(rows[0]["sizing"]["is_dual_sided"], True)
        self.assertEqual(rows[0]["sizing"]["stake"], 12.5)

    async def test_executed_stake_honors_sizing_not_default(self):
        """If sizing says $7, the fill cannot be $35."""
        tick = "KXBTC15M-26AUG101515-15"
        sizing = {"stake": 7.0, "reason": "conf+edge+scalp", "clamped": False, "raw_stake": 7.0}
        await self.store.record_path_fills(
            ticker=tick,
            close_time="2026-08-10T19:15:00+00:00",
            fills=[
                {"fill_kind": "scale", "side": "DOWN", "entry_cents": 48.0, "stake": 35.0, "sizing": sizing},
            ],
            asset="btc",
            sizing=sizing,
        )
        async with self.store.Session() as session:
            from sqlalchemy import select
            rows = (await session.execute(
                select(WindowCall).where(WindowCall.ticker == tick)
            )).scalars().all()
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(float(rows[0].paper_stake), 7.0)
        self.assertLessEqual(float(rows[0].paper_stake), float(settings.DYNAMIC_SIZING_MAX))

    async def test_15m_sit_does_not_open_one_call_ticket(self):
        """Holding UP on the path book must not fall through to max_calls=1."""
        tick = "KXBTC15M-26AUG101400-00"
        await self.store.log_signal(
            {
                "direction": "UP",
                "confidence": 70,
                "path_fills": [],
            },
            [],
            market_ticker=tick,
            close_time="2026-08-10T18:00:00+00:00",
            up_pct=48.0,
            down_pct=52.0,
            asset="btc",
        )
        async with self.store.Session() as session:
            from sqlalchemy import select
            rows = (await session.execute(
                select(WindowCall).where(WindowCall.ticker == tick)
            )).scalars().all()
        self.assertEqual(rows, [])

    async def test_cut_then_scorecard_uses_realized_pnl(self):
        tick = "KXBTC15M-26AUG101415-15"
        close = "2026-08-10T18:15:00+00:00"
        await self.store.record_path_fills(
            ticker=tick,
            close_time=close,
            fills=[{"fill_kind": "open", "side": "UP", "entry_cents": 48.0, "stake": 10.0}],
            asset="btc",
        )
        await self.store.record_path_fills(
            ticker=tick,
            close_time=close,
            fills=[{
                "fill_kind": "cut",
                "side": "UP",
                "entry_cents": 48.0,
                "exit_cents": 43.0,
                "stake": 10.0,
                "paper_pnl": -1.0417,
            }],
            asset="btc",
        )
        acc = await self.store.get_accuracy(asset="btc")
        self.assertEqual(acc["total"], 1)
        self.assertEqual(acc["correct"], 0)
        self.assertEqual(acc["wrong"], 1)

    async def test_eth_path_fills_are_refused(self):
        tick = "KXETHD-26AUG1016-T2400"
        await self.store.record_path_fills(
            ticker=tick,
            close_time="2026-08-10T16:00:00+00:00",
            fills=[
                {"fill_kind": "dual_open", "side": "UP", "entry_cents": 42.0, "stake": 10.0},
                {"fill_kind": "dual_open", "side": "DOWN", "entry_cents": 42.0, "stake": 10.0},
            ],
            asset="eth",
        )
        await self.store.log_signal(
            {
                "direction": "BOTH",
                "confidence": 70,
                "path_fills": [
                    {"fill_kind": "dual_open", "side": "UP", "entry_cents": 42.0, "stake": 10.0},
                ],
            },
            [],
            market_ticker=tick,
            close_time="2026-08-10T16:00:00+00:00",
            up_pct=48.0,
            down_pct=52.0,
            asset="eth",
        )
        async with self.store.Session() as session:
            from sqlalchemy import select
            rows = (await session.execute(
                select(WindowCall).where(WindowCall.ticker == tick)
            )).scalars().all()
        self.assertEqual(rows, [])


class PathBookLiveGuardTests(unittest.TestCase):
    def test_leader_fills_at_ask_not_mid(self):
        from backend.agents.leader import Leader
        chair = Leader()
        overlay = chair._apply_15m_path_book(
            ticker="KXBTC15M-26AUG101200-00",
            window_id="2026-08-10T16:00:00+00:00",
            lean="UP",
            conf=70,
            score=0.4,
            summary="lean UP",
            side_odds=48.0,
            up_pct=48.0,
            p_finish=0.6,
            ev_cents=6.0,
            regime_features={
                "asset": "btc",
                "ticker": "KXBTC15M-26AUG101200-00",
                "mins_left": 10.0,
                "window_minutes": 15.0,
                "yes_ask": 42.0,
                "no_ask": 42.0,
                "yes_bid": 40.0,
                "yes_mid": 41.0,
                "up_pct": 41.0,
                "kalshi_healthy": True,
            },
            gate_notes=[],
        )
        self.assertEqual(overlay["direction"], "BOTH")
        sides = {f["side"]: f for f in overlay["path_fills"]}
        self.assertEqual(sides["UP"]["entry_cents"], 42.0)
        self.assertEqual(sides["DOWN"]["entry_cents"], 42.0)
        self.assertNotEqual(sides["UP"]["entry_cents"], 41.0)
        sized = float((overlay.get("sizing") or {}).get("stake") or 0)
        self.assertGreater(sized, 0.0)
        self.assertLessEqual(float(sides["UP"]["stake"]), sized + 1e-9)
        self.assertLessEqual(float(sides["DOWN"]["stake"]), sized + 1e-9)
        self.assertLessEqual(float(sides["UP"]["stake"]), float(settings.DYNAMIC_SIZING_MAX))
        self.assertLessEqual(float(sides["DOWN"]["stake"]), float(settings.DYNAMIC_SIZING_MAX))

    def test_leader_unbalanced_dual_cannot_exceed_sizing(self):
        """equal_contract_stakes used to print $35 on the expensive door when sizing said $7."""
        from backend.agents.leader import Leader
        chair = Leader()
        overlay = chair._apply_15m_path_book(
            ticker="KXBTC15M-26AUG101245-45",
            window_id="2026-08-10T16:45:00+00:00",
            lean="DOWN",
            conf=40,
            score=0.2,
            summary="lean DOWN",
            side_odds=70.0,
            up_pct=20.0,
            p_finish=0.45,
            ev_cents=-8.0,
            regime_features={
                "asset": "btc",
                "ticker": "KXBTC15M-26AUG101245-45",
                "mins_left": 10.0,
                "window_minutes": 15.0,
                "yes_ask": 22.0,
                "no_ask": 70.0,
                "yes_bid": 20.0,
                "no_bid": 68.0,
                "yes_mid": 21.0,
                "kalshi_healthy": True,
            },
            gate_notes=[],
        )
        sized = float((overlay.get("sizing") or {}).get("stake") or 0)
        for fill in overlay.get("path_fills") or []:
            self.assertLessEqual(float(fill["stake"]), max(sized, 0.0) + 1e-9)
            self.assertLessEqual(float(fill["stake"]), float(settings.DYNAMIC_SIZING_MAX))
            self.assertNotAlmostEqual(float(fill["stake"]), 35.0)

    def test_leader_sits_without_real_asks(self):
        from backend.agents.leader import Leader
        chair = Leader()
        overlay = chair._apply_15m_path_book(
            ticker="KXBTC15M-26AUG101200-00",
            window_id="2026-08-10T16:00:00+00:00",
            lean="UP",
            conf=70,
            score=0.4,
            summary="lean UP",
            side_odds=48.0,
            up_pct=48.0,
            p_finish=0.6,
            ev_cents=8.0,
            regime_features={
                "asset": "btc",
                "ticker": "KXBTC15M-26AUG101200-00",
                "mins_left": 10.0,
                "window_minutes": 15.0,
                "yes_mid": 48.0,
                "up_pct": 48.0,
                "kalshi_healthy": True,
            },
            gate_notes=[],
        )
        self.assertEqual(overlay["direction"], "WAIT")
        self.assertEqual(overlay["path_fills"], [])

    def test_eth_never_uses_path_book(self):
        from backend.agents.leader import Leader
        chair = Leader()
        self.assertFalse(chair._is_15m_btc_path({"asset": "eth"}, "KXETHD-26AUG1616-T2000.00"))
        self.assertFalse(chair._is_15m_btc_path({"asset": "eth", "window_minutes": 15}, None))
        self.assertTrue(chair._is_15m_btc_path({"asset": "btc"}, "KXBTC15M-26AUG161200-00"))


class SatoshiExploreLockTests(unittest.TestCase):
    """Satoshi / BTC 15m Chair only. Vitalik / Ares / Oracle stay put."""

    def _book(self):
        return {
            "yes_depth": 40,
            "no_depth": 30,
            "yes_bid_sz": 20,
            "no_bid_sz": 15,
            "yes_bid_px": 47,
            "no_bid_px": 51,
            "has_size": True,
            "measured": True,
            "book_state": "ok",
        }

    def _overlay(self, **over):
        from backend.agents.leader import Leader
        chair = Leader()
        feat = {
            "asset": "btc",
            "ticker": "KXBTC15M-26AUG161530-30",
            "mins_left": 10.0,
            "window_minutes": 15.0,
            "yes_ask": 48.0,
            "no_ask": 52.0,
            "yes_bid": 47.0,
            "no_bid": 51.0,
            "yes_mid": 48.0,
            "kalshi_healthy": True,
            "book_depth": self._book(),
        }
        feat.update(over.pop("regime_features", {}))
        return chair._apply_15m_path_book(
            ticker="KXBTC15M-26AUG161530-30",
            window_id="2026-08-16T20:30:00+00:00",
            lean=over.get("lean", "UP"),
            conf=over.get("conf", 62),
            score=over.get("score", 0.2),
            summary="explore lean",
            side_odds=over.get("side_odds", 48.0),
            up_pct=over.get("up_pct", 48.0),
            p_finish=over.get("p_finish", 0.56),
            ev_cents=over.get("ev_cents", 0.4),
            regime_features=feat,
            gate_notes=[],
        )

    def test_explore_lock_when_ev_nonneg_on_real_20_80_book(self):
        mid = self._overlay(ev_cents=0.4)
        self.assertNotEqual(mid["direction"], "WAIT")
        self.assertTrue(mid.get("path_fills"))
        cheap = self._overlay(
            ev_cents=0.2,
            lean="UP",
            side_odds=12.0,
            up_pct=12.0,
            regime_features={
                "yes_ask": 12.0,
                "no_ask": 88.0,
                "yes_bid": 11.0,
                "no_bid": 87.0,
                "yes_mid": 12.0,
                "book_depth": {
                    **self._book(),
                    "yes_bid_px": 11,
                    "no_bid_px": 87,
                },
            },
        )
        self.assertEqual(cheap["direction"], "WAIT")
        self.assertEqual(cheap.get("path_fills"), [])
        edge = self._overlay(
            ev_cents=0.2,
            lean="UP",
            side_odds=22.0,
            up_pct=22.0,
            regime_features={
                "yes_ask": 22.0,
                "no_ask": 78.0,
                "yes_bid": 21.0,
                "no_bid": 77.0,
                "yes_mid": 22.0,
                "book_depth": {
                    **self._book(),
                    "yes_bid_px": 21,
                    "no_bid_px": 77,
                },
            },
        )
        self.assertNotEqual(edge["direction"], "WAIT")
        self.assertTrue(edge.get("path_fills"))

    def test_veto_holds_on_99_stale_empty(self):
        wall = self._overlay(
            ev_cents=20.0,
            side_odds=99.0,
            up_pct=99.0,
            regime_features={"yes_ask": 99.0, "no_ask": 1.0, "yes_mid": 99.0},
        )
        self.assertEqual(wall["direction"], "WAIT")
        self.assertEqual(wall.get("path_fills"), [])
        stale = self._overlay(regime_features={"stale": True, "kalshi_healthy": False})
        self.assertEqual(stale["direction"], "WAIT")
        self.assertEqual(stale.get("path_fills"), [])
        empty = self._overlay(regime_features={
            "book_depth": {
                "yes_depth": 0,
                "no_depth": 0,
                "has_size": False,
                "measured": True,
                "book_state": "dead",
            },
        })
        self.assertEqual(empty["direction"], "WAIT")
        self.assertEqual(empty.get("path_fills"), [])
        one_sided = self._overlay(
            ev_cents=8.0,
            regime_features={
                "yes_ask": 48.0,
                "no_ask": None,
                "yes_bid": 47.0,
                "no_bid": None,
                "yes_mid": 48.0,
                "book_depth": {
                    "yes_depth": 40,
                    "no_depth": 0,
                    "yes_bid_sz": 20,
                    "no_bid_sz": 0,
                    "yes_bid_px": 47,
                    "has_size": True,
                    "measured": True,
                    "book_state": "one_sided",
                },
            },
        )
        self.assertEqual(one_sided["direction"], "WAIT")
        self.assertEqual(one_sided.get("path_fills"), [])

    def test_eth_vitalik_still_one_lock_not_path(self):
        from backend.agents.leader import Leader
        from backend.services.desk_hunter import MIN_EV_SIT
        chair = Leader()
        self.assertFalse(chair._is_15m_btc_path({"asset": "eth"}, "KXETHD-26AUG1616-T2000.00"))
        self.assertEqual(early_no_lock_mins_for(ticker="KXETHD-26AUG1616-T2000.00", asset="eth"), 10.0)
        self.assertEqual(float(settings.MIN_EV_CENTS), 3.0)
        self.assertEqual(float(MIN_EV_SIT), 3.0)
        ats = (ROOT / "backend" / "services" / "desk_ats.py").read_text(encoding="utf-8")
        ora = (ROOT / "backend" / "services" / "desk_oracle.py").read_text(encoding="utf-8")
        self.assertIn("20–80", ats)
        self.assertIn("leftover) < 3.0", ats)
        self.assertIn("20–80", ora)


class Backfill15mTests(unittest.IsolatedAsyncioTestCase):
    def test_finish_era_brain_is_dropped(self):
        from backend.learning.seat_backfill_15m import ensure_15m_learner
        old = AdaptiveLearner(asset="btc")
        old.backfill = {"tag": "backfill_15m", "windows_graded": 6330}
        old.correct["candle_btc"] = 3925
        fresh = ensure_15m_learner(old)
        self.assertEqual(sum(fresh.correct.values()), 0)
        path = AdaptiveLearner(asset="btc")
        path.backfill = {"tag": "backfill_15m", "score": "realized_paper_pnl", "windows_graded": 12}
        path.correct["candle_btc"] = 4
        kept = ensure_15m_learner(path)
        self.assertEqual(kept.correct.get("candle_btc"), 4)

    def test_contract(self):
        c = backfill_15m_contract()
        self.assertEqual(c["series"], ["KXBTC15M"])
        self.assertEqual(c["assets"], ["btc"])
        self.assertEqual(c["window_minutes"], 15.0)
        self.assertFalse(c["coinglass"])
        self.assertFalse(c["port_1h_weights"])
        self.assertFalse(c["follower"])
        self.assertFalse(c["live_orders"])
        self.assertEqual(c["score"], "realized_paper_pnl")
        self.assertTrue(c["dual_sided"])
        self.assertTrue(c["official_result_only"])
        self.assertTrue(c["merge"])
        self.assertFalse(c["wipe_live_brain"])
        self.assertIn("no window_calls", c["displayed_hit_rate"])
        self.assertEqual(c["eth_1h"], "untouched")
        self.assertIn("CoinGlass 1h is the wrong timeframe", json.dumps(c["seats_skipped"]))

    def test_drops_coinglass_votes(self):
        votes = {
            "candle_btc": {"direction": "UP", "confidence": 60},
            "funding": {"direction": "DOWN", "confidence": 80},
            "oi_pressure": {"direction": "UP", "confidence": 70},
            "liq": {"direction": "DOWN", "confidence": 70},
            "orderflow": {"direction": "UP", "confidence": 70},
        }
        clean = filter_15m_votes(votes)
        self.assertIn("candle_btc", clean)
        self.assertNotIn("funding", clean)
        self.assertNotIn("oi_pressure", clean)
        self.assertNotIn("liq", clean)
        self.assertNotIn("orderflow", clean)

    async def test_grade_one_merges_into_15m_brain_not_1h(self):
        learner = AdaptiveLearner(asset="btc")
        before_eth = dict(AdaptiveLearner(asset="eth").correct)
        market = {
            "ticker": "KXBTC15M-26AUG101200-00",
            "event_ticker": "KXBTC15M-26AUG101200",
            "status": "settled",
            "result": "yes",
            "close_time": "2026-08-10T16:00:00+00:00",
            "floor_strike": 64000,
        }
        start = datetime(2026, 8, 10, 15, 30, tzinfo=timezone.utc)
        candles = []
        px = 64020.0
        for i in range(40):
            t = start.timestamp() * 1000 + i * 60_000
            candles.append({
                "open_time": int(t),
                "open": px,
                "high": px + 15,
                "low": px - 10,
                "close": px + 4,
                "volume": 12.0,
            })
            px += 4

        async def _candles():
            return candles

        rec = await grade_one_15m(market, learner=learner, fetch_candles=_candles)
        self.assertEqual(rec.get("status"), "graded")
        self.assertEqual(rec.get("score"), "realized_paper_pnl")
        self.assertIn(rec.get("y_finish"), ("UP", "DOWN"))
        self.assertNotEqual(rec.get("score"), "finish_match")
        self.assertNotIn("funding", rec.get("seats") or [])
        n = sum(int(learner.correct.get(s) or 0) + int(learner.wrong.get(s) or 0) for s in learner.correct)
        self.assertGreater(n, 0)
        self.assertEqual(dict(AdaptiveLearner(asset="eth").correct), before_eth)

        with tempfile.TemporaryDirectory() as td:
            report = await run_btc_15m_backfill(
                learner=learner,
                markets=[market],
                fetch_candles=_candles,
                persist=True,
                data_root=Path(td),
                force=True,
            )
            self.assertTrue(report["ok"])
            self.assertGreaterEqual(int(report["windows_graded"] or 0), 1)
            self.assertFalse(report["coinglass"])
            self.assertFalse(report["port_1h_weights"])
            self.assertTrue((Path(td) / BRAIN_FILE_BTC_15M).is_file())
            self.assertFalse((Path(td) / "council-learning-btc.json").is_file())
            self.assertFalse((Path(td) / "council-learning-eth.json").is_file())

    async def test_replay_merge_does_not_bump_displayed_hits(self):
        learner = AdaptiveLearner(asset="btc")
        learner.lock_n = 7
        learner.backfill = {"tag": "backfill_15m", "score": "realized_paper_pnl", "windows_graded": 2}
        before_lock = int(learner.lock_n)
        before_card = floor_scorecard(
            {"correct": 4, "wrong": 1},
            {"correct": 2, "wrong": 1},
        )
        market = {
            "ticker": "KXBTC15M-26AUG101215-15",
            "event_ticker": "KXBTC15M-26AUG101215",
            "status": "settled",
            "result": "no",
            "close_time": "2026-08-10T16:15:00+00:00",
            "floor_strike": 64000,
        }
        start = datetime(2026, 8, 10, 15, 45, tzinfo=timezone.utc)
        candles = []
        px = 63980.0
        for i in range(40):
            t = start.timestamp() * 1000 + i * 60_000
            candles.append({
                "open_time": int(t),
                "open": px,
                "high": px + 12,
                "low": px - 8,
                "close": px - 3,
                "volume": 11.0,
            })
            px -= 3

        async def _candles():
            return candles

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            report = await run_btc_15m_backfill(
                learner=learner,
                markets=[market],
                fetch_candles=_candles,
                persist=True,
                data_root=root,
                force=True,
            )
            self.assertTrue(report["ok"])
            self.assertGreaterEqual(int(report["windows_graded"] or 0), 1)
            self.assertEqual(learner.lock_n, before_lock)
            self.assertIn("no window_calls", report["displayed_hit_rate"])
            self.assertFalse((root / "window_calls.json").is_file())
            self.assertIn("skip_reasons", report)
            self.assertEqual(report.get("oldest_ticker"), "KXBTC15M-26AUG101215-15")
            self.assertEqual(report.get("newest_ticker"), "KXBTC15M-26AUG101215-15")
            after_card = floor_scorecard(
                {"correct": 4, "wrong": 1},
                {"correct": 2, "wrong": 1},
            )
            self.assertEqual(after_card["btc"]["correct"], before_card["btc"]["correct"])
            self.assertEqual(after_card["eth"]["correct"], before_card["eth"]["correct"])
            self.assertEqual(after_card["match"], before_card["match"])


class PathPnlTests(unittest.TestCase):
    def test_dual_leftover_and_equal_contracts(self):
        from backend.learning.btc15m_path import (
            PathBook,
            PathInputs,
            combined_leftover,
            decide_action,
            dual_attractive,
            equal_contract_stakes,
            realized_pnl,
            settle_exit_cents,
        )
        left = combined_leftover(42.0, 42.0)
        self.assertIsNotNone(left)
        self.assertGreaterEqual(left, 3.0)
        self.assertTrue(dual_attractive(42.0, 42.0))
        self.assertFalse(dual_attractive(52.0, 52.0))
        self.assertFalse(dual_attractive(5.0, 5.0))
        up_s, down_s = equal_contract_stakes(40.0, 50.0, unit=10.0)
        self.assertAlmostEqual(up_s, 10.0)
        self.assertAlmostEqual(down_s, 12.5)
        self.assertAlmostEqual(realized_pnl(10.0, 50.0, 100.0), 10.0)
        self.assertAlmostEqual(realized_pnl(10.0, 50.0, 0.0), -10.0)
        self.assertAlmostEqual(realized_pnl(10.0, 48.0, 52.0), 10.0 * 4.0 / 48.0, places=3)
        self.assertEqual(settle_exit_cents("UP", "UP"), 100.0)
        self.assertEqual(settle_exit_cents("DOWN", "UP"), 0.0)

        book = PathBook(ticker="KXBTC15M-X")
        dual = decide_action(PathInputs(4.0, 11.0, 42.0, 42.0, lean="UP", ev_cents=4.0), book)
        self.assertEqual(dual.action, "DUAL")
        self.assertEqual({f.side for f in dual.fills}, {"UP", "DOWN"})
        tight = decide_action(PathInputs(4.0, 11.0, 52.0, 52.0, lean="UP", ev_cents=8.0), book)
        self.assertNotEqual(tight.action, "DUAL")

    def test_second_leg_requires_leftover_after_vig(self):
        from backend.learning.btc15m_path import PathBook, PathInputs, PathLeg, decide_action
        held = PathBook(ticker="KXBTC15M-X", open_legs=[PathLeg("UP", 48.0, 10.0)])
        # Lean flipped, but 52+52 has no room after vig — do not add DOWN.
        out = decide_action(PathInputs(6.0, 9.0, 52.0, 52.0, lean="DOWN", ev_cents=8.0), held)
        self.assertEqual(out.action, "SIT")
        self.assertEqual(out.reason, "second_leg_needs_leftover")
        self.assertEqual(out.fills, [])

    def test_chalk_sits_and_cannot_scale(self):
        from backend.learning.btc15m_path import PathBook, PathInputs, PathLeg, decide_action
        empty = PathBook(ticker="KXBTC15M-X")
        sit = decide_action(PathInputs(6.0, 9.0, 99.0, 1.0, lean="UP", ev_cents=20.0, chalk=True), empty)
        self.assertEqual(sit.action, "SIT")
        self.assertEqual(sit.reason, "chalk")
        held = PathBook(ticker="KXBTC15M-X", open_legs=[PathLeg("UP", 48.0, 10.0)])
        scale = decide_action(PathInputs(6.0, 9.0, 99.0, 1.0, lean="UP", ev_cents=20.0, chalk=True), held)
        self.assertEqual(scale.action, "SIT")
        self.assertEqual(scale.reason, "chalk")
        self.assertEqual(scale.fills, [])
        self.assertNotEqual(scale.action, "SCALE")
        self.assertNotEqual(scale.action, "DUAL")
        self.assertNotEqual(scale.action, "OPEN")
        self.assertNotEqual(scale.action, "CUT")

    def test_99c_path_exit_sits(self):
        """A 99¢ path exit is a sit, not a scale/cut. Same rail as the #50 99¢ sit."""
        from backend.learning.btc15m_path import PathBook, PathInputs, PathLeg, decide_action
        held_down = PathBook(ticker="KXBTC15M-X", open_legs=[PathLeg("DOWN", 48.0, 10.0)])
        out = decide_action(
            PathInputs(6.0, 9.0, 99.0, 1.0, lean="DOWN", ev_cents=20.0, chalk=True),
            held_down,
        )
        self.assertEqual(out.action, "SIT")
        self.assertEqual(out.reason, "chalk")
        self.assertEqual(out.fills, [])
        self.assertNotEqual(out.action, "CUT")
        self.assertNotEqual(out.action, "SCALE")
        self.assertNotEqual(out.action, "FLIP")
        held_up = PathBook(ticker="KXBTC15M-X", open_legs=[PathLeg("UP", 48.0, 10.0)])
        out_up = decide_action(PathInputs(6.0, 9.0, 99.0, 1.0, lean="UP", ev_cents=20.0), held_up)
        self.assertEqual(out_up.action, "SIT")
        self.assertEqual(out_up.fills, [])

    def test_real_asks_never_use_mid(self):
        from backend.learning.btc15m_path import real_yes_no_asks
        ya, na = real_yes_no_asks(yes_ask=52.0, yes_bid=48.0)
        self.assertEqual(ya, 52.0)
        self.assertEqual(na, 52.0)  # 100 − yes bid
        none_ya, none_na = real_yes_no_asks()
        self.assertIsNone(none_ya)
        self.assertIsNone(none_na)

    def test_scale_cut_flip(self):
        from backend.learning.btc15m_path import PathBook, PathInputs, PathLeg, apply_fills, decide_action
        book = PathBook(ticker="KXBTC15M-X", open_legs=[PathLeg("UP", 48.0, 10.0)])
        scale = decide_action(PathInputs(6.0, 9.0, 53.0, 49.0, lean="UP", ev_cents=4.0), book)
        self.assertEqual(scale.action, "SCALE")
        cut_book = PathBook(ticker="KXBTC15M-X", open_legs=[PathLeg("UP", 48.0, 10.0)])
        # Other door at 92¢ is outside 20–80, so flip is blocked and CUT still fires.
        cut = decide_action(PathInputs(6.0, 9.0, 42.0, 92.0, lean="UP", ev_cents=4.0), cut_book)
        self.assertEqual(cut.action, "CUT")
        flip_book = PathBook(ticker="KXBTC15M-X", open_legs=[PathLeg("UP", 48.0, 10.0)])
        flip = decide_action(PathInputs(6.0, 9.0, 40.0, 55.0, lean="DOWN", ev_cents=4.0), flip_book)
        self.assertEqual(flip.action, "FLIP")
        apply_fills(flip_book, flip.fills, 6.0)
        self.assertEqual(flip_book.held_sides(), {"DOWN"})
        self.assertLess(flip_book.realized_pnl, 0.0)

    def test_sit_bands_and_path_not_finish(self):
        from backend.learning.btc15m_path import PathBook, PathInputs, decide_action, simulate_path
        book = PathBook()
        early = decide_action(PathInputs(1.0, 14.0, 42.0, 42.0, lean="UP", ev_cents=8.0), book)
        self.assertEqual(early.action, "SIT")
        late = decide_action(PathInputs(13.5, 1.5, 48.0, 52.0, lean="UP", ev_cents=-1.0), book)
        self.assertEqual(late.action, "SIT")
        start = datetime(2026, 8, 10, 15, 45, tzinfo=timezone.utc)
        candles = []
        px = 64020.0
        for i in range(16):
            t = start.timestamp() * 1000 + i * 60_000
            candles.append({"open_time": int(t), "open": px, "high": px + 10, "low": px - 8, "close": px + 3, "volume": 10})
            px += 3
        path = simulate_path(
            candles=candles,
            floor_strike=64000,
            close_time=datetime(2026, 8, 10, 16, 0, tzinfo=timezone.utc),
            votes={"candle_btc": {"direction": "UP", "confidence": 70}},
            y_finish="DOWN",
            ticker="KXBTC15M-26AUG101200-00",
        )
        self.assertEqual(path["score"], "realized_paper_pnl")
        self.assertIn("net_pnl", path)
        # Official settle DOWN is not the win label — P&L is.
        self.assertEqual(path["y_finish"], "DOWN")
        self.assertNotIn("finish_match", path)

    def test_learner_uses_pnl_not_settle(self):
        learner = AdaptiveLearner(asset="btc")
        votes = {
            "candle_btc": {"direction": "UP", "confidence": 70},
            "volume": {"direction": "DOWN", "confidence": 60},
        }
        learner.learn_from_path_pnl(votes, 8.0, {"UP"}, count_as_lock=False)
        self.assertGreater(learner.correct.get("candle_btc", 0), 0)
        self.assertGreater(learner.wrong.get("volume", 0), 0)
        cold = AdaptiveLearner(asset="btc")
        cold.learn_from_path_pnl(votes, -8.0, {"UP"}, count_as_lock=False)
        self.assertGreater(cold.wrong.get("candle_btc", 0), 0)
        self.assertGreater(cold.correct.get("volume", 0), 0)


class WireAndUiTests(unittest.TestCase):
    def test_wire_newest(self):
        self.assertIn("2026-08-16-herald-patch-20-80", WIRE)
        self.assertIn("2026-08-16-raijin-explore", WIRE)
        self.assertIn("2026-08-16-satoshi-explore-15m-replay", WIRE)
        self.assertIn("2026-08-16-path-stake-chalk-exit", WIRE)
        self.assertIn("2026-08-16-majority-wash-lock", WIRE)
        self.assertIn("2026-08-16-herald-leftovers", WIRE)
        self.assertIn("2026-08-16-btc-15m-path-pnl", WIRE)
        self.assertLess(WIRE.find("2026-08-16-herald-patch-20-80"), WIRE.find("2026-08-16-raijin-explore"))
        self.assertLess(WIRE.find("2026-08-16-raijin-explore"), WIRE.find("2026-08-16-satoshi-explore-15m-replay"))
        self.assertLess(WIRE.find("2026-08-16-satoshi-explore-15m-replay"), WIRE.find("2026-08-16-path-stake-chalk-exit"))
        self.assertLess(WIRE.find("2026-08-16-path-stake-chalk-exit"), WIRE.find("2026-08-16-majority-wash-lock"))
        self.assertLess(WIRE.find("2026-08-16-majority-wash-lock"), WIRE.find("2026-08-16-herald-leftovers"))
        self.assertLess(WIRE.find("2026-08-16-herald-leftovers"), WIRE.find("2026-08-16-btc-15m-path-pnl"))
        self.assertLess(WIRE.find("2026-08-16-btc-15m-path-pnl"), WIRE.find("2026-08-16-btc-15m-retrain"))
        self.assertLess(WIRE.find("2026-08-16-btc-15m-retrain"), WIRE.find("2026-08-16-eth-slate-ares-oracle-lock"))
        chunk = WIRE.split("2026-08-16-btc-15m-path-pnl", 1)[1][:1600]
        self.assertIn("new brain", chunk)
        self.assertIn("ETH stays 1H", chunk)
        self.assertIn("path P&L", chunk)
        self.assertIn("dual-sided", chunk)
        self.assertIn("not one irreversible directional lock", chunk)
        self.assertIn("not close-direction hits", chunk)
        self.assertIn("WAIT is a skip", chunk)
        self.assertIn("Both legs only when UP ask + DOWN ask leaves room after vig", chunk)
        self.assertIn("Paper fill at the real ask, not mid", chunk)
        self.assertIn("Dead 99¢ book = sit", chunk)
        self.assertIn("You cannot scale out of chalk", chunk)
        self.assertIn("ETH 1H stays one-lock", chunk)
        self.assertIn("Do not port 1H weights", chunk)
        self.assertIn("Kill the One-Call", chunk)
        self.assertIn("Dynamic sizing", chunk)
        self.assertIn("Holding both sides is expected", chunk)
        self.assertIn("Specialists keep gathering the full 15 minutes", chunk)
        self.assertIn("LONG_UP", chunk)
        self.assertIn("REDUCE", chunk)
        self.assertIn("Path scoreboard", chunk)
        self.assertIn("Sizing audit", chunk)
        self.assertIn("Hard maxes beat Kelly", chunk)
        self.assertIn("open_risk counts both legs", chunk)
        self.assertIn("Do NOT wire Follower", chunk)
        self.assertIn("Paper", chunk)
        self.assertIn("Follower OFF", chunk)
        self.assertIn("Live OFF", chunk)
        self.assertNotIn("ZT", chunk)
        self.assertNotIn("KX", chunk)
        herald = WIRE.split("2026-08-16-herald-patch-20-80", 1)[1][:1400]
        self.assertIn("Herald", herald)
        self.assertIn("20–80", herald)
        self.assertIn("dead book", herald)
        self.assertIn("one-sided", herald)
        self.assertIn("Satoshi", herald)
        self.assertIn("Raijin", herald)
        self.assertIn("Vitalik", herald)
        self.assertIn("Ares", herald)
        self.assertIn("Oracle", herald)
        self.assertIn("Paper", herald)
        self.assertIn("Follower OFF", herald)
        self.assertIn("Satoshi’s Council", herald)
        self.assertNotIn("Phantom", herald)
        self.assertNotIn("ZT", herald)
        raijin = WIRE.split("2026-08-16-raijin-explore", 1)[1][:1400]
        self.assertIn("Raijin", raijin)
        self.assertIn("Dallas", raijin)
        self.assertIn("EV", raijin)
        self.assertIn("sick", raijin)
        self.assertIn("stale", raijin)
        self.assertIn("empty", raijin)
        self.assertIn("Vitalik", raijin)
        self.assertIn("Ares", raijin)
        self.assertIn("Oracle", raijin)
        self.assertIn("Love Field", raijin)
        self.assertIn("Paper", raijin)
        self.assertIn("Follower OFF", raijin)
        self.assertIn("Satoshi’s Council", raijin)
        self.assertNotIn("Phantom", raijin)
        self.assertNotIn("ZT", raijin)
        explore = WIRE.split("2026-08-16-satoshi-explore-15m-replay", 1)[1][:1400]
        self.assertIn("Satoshi", explore)
        self.assertIn("EV", explore)
        self.assertIn("10–90", explore)
        self.assertIn("99¢", explore)
        self.assertIn("stale", explore)
        self.assertIn("empty", explore)
        self.assertIn("clamp_min", explore)
        self.assertIn("Vitalik", explore)
        self.assertIn("Ares", explore)
        self.assertIn("Oracle", explore)
        self.assertIn("replay", explore.lower())
        self.assertIn("merge", explore.lower())
        self.assertIn("hit slate", explore.lower())
        self.assertIn("Paper", explore)
        self.assertIn("Follower OFF", explore)
        self.assertIn("Satoshi’s Council", explore)
        self.assertNotIn("Phantom", explore)
        self.assertNotIn("ZT", explore)
        leftover = WIRE.split("2026-08-16-herald-leftovers", 1)[1][:1200]
        self.assertIn("CASCADE sits WAIT", leftover)
        self.assertIn("LONG_UP", leftover)
        self.assertIn("visible strip", leftover)
        self.assertIn("150–220KB", leftover)
        self.assertIn("Paper", leftover)
        self.assertIn("Follower OFF", leftover)
        self.assertNotIn("ZT", leftover)
        self.assertNotIn("Phantom", leftover)
        wash = WIRE.split("2026-08-16-majority-wash-lock", 1)[1][:1200]
        self.assertIn("majority-down", wash)
        self.assertIn("WAIT chair", wash)
        self.assertIn("chairLockDir", wash)
        self.assertIn("majority-wait", wash)
        self.assertIn("Paper", wash)
        self.assertIn("Follower OFF", wash)
        self.assertIn("ETH stays 1H one-lock", wash)
        self.assertNotIn("ZT", wash)
        self.assertNotIn("Phantom", wash)
        stake = WIRE.split("2026-08-16-path-stake-chalk-exit", 1)[1][:1200]
        self.assertIn("paper_stake was $35", stake)
        self.assertIn("sizing said $7", stake)
        self.assertIn("clamp_min", stake)
        self.assertIn("99¢ path exit", stake)
        self.assertIn("Paper", stake)
        self.assertIn("Follower OFF", stake)
        self.assertIn("ETH stays 1H one-lock", stake)
        self.assertNotIn("ZT", stake)
        self.assertNotIn("Phantom", stake)

    def test_ui_labels(self):
        self.assertIn('id="ledWindowLabel">15M WINDOW', HTML)
        self.assertIn('id="chartPairTitle">BTC · 1m</span><span class="chart-window-chip">15M WINDOW</span>', HTML)
        self.assertIn('id="chartEthTitle">ETH · 1m</span><span class="chart-window-chip">1H WINDOW</span>', HTML)
        self.assertIn("function cryptoWindowLabel", JS)
        self.assertIn('return "15M WINDOW"', JS)
        self.assertIn('return "1H WINDOW"', JS)
        self.assertIn("keep gathering the full 15 minutes", JS)
        self.assertIn("Hard maxes beat Kelly", JS)
        self.assertNotIn(
            "First firm full UP/DOWN that clears the gates becomes the single LOCKED call.",
            JS,
        )

    def test_constraints_hold(self):
        self.assertEqual(HTML.count('class="floor-chair-tog"'), 5)
        self.assertIn('id="stillToggle"', HTML)
        self.assertIn("/council-mark.png", HTML)
        self.assertTrue(can_final_lock("leader"))
        self.assertTrue(can_final_lock("chair"))
        self.assertFalse(can_final_lock("candle_btc"))
        self.assertFalse(can_final_lock("volume"))
        self.assertNotIn("ZT", WIRE.split("2026-08-16-btc-15m-path-pnl", 1)[1][:800])
        self.assertFalse(settings.SIDE_TABLE_LIVE)
        self.assertFalse(settings.FRONT_LIVE)
        self.assertIn("function tallyTone(", JS)
        self.assertIn("LONG_UP", JS.split("function tallyTone", 1)[1][:220])
        self.assertIn("const d = tallyTone(a.direction)", JS)
        self.assertIn("function majorityDirOf(", JS)
        self.assertIn("function majorityWashOf(", JS)
        wash_fn = JS.split("function majorityWashOf", 1)[1].split("function ", 1)[0]
        self.assertIn("chairLockDir(", wash_fn)
        self.assertIn("locked_call", wash_fn)
        self.assertIn('return "WAIT"', wash_fn)
        self.assertIn("majorityDirOf(agents)", wash_fn)
        self.assertIn("majorityWashOf(roster, st)", JS)
        self.assertIn("majorityWashOf(preAgents, state)", JS)
        self.assertNotIn("const maj = majorityDirOf(", JS)
        self.assertIn("const BTC_STRIP_KEYS", JS)
        self.assertIn("function onVisibleStrip(", JS)
        self.assertLessEqual(JS.split("const BTC_STRIP_LABELS", 1)[1].split("];", 1)[0].count(",") + 1, 12)
        self.assertIn("WIRE", JS.split("const BTC_STRIP_LABELS", 1)[1].split("];", 1)[0])
        self.assertIn("CASCADE", JS.split("const BTC_STRIP_LABELS", 1)[1].split("];", 1)[0])
        ares = ROOT / "frontend" / "static" / "ares-wait.png"
        cowboy = ROOT / "frontend" / "static" / "bots" / "raijin-chair.png"
        self.assertTrue(ares.read_bytes().startswith(b"\x89PNG"))
        self.assertTrue(cowboy.read_bytes().startswith(b"\x89PNG"))
        self.assertGreaterEqual(ares.stat().st_size, 150_000)
        self.assertLessEqual(ares.stat().st_size, 220_000)
        self.assertGreaterEqual(cowboy.stat().st_size, 150_000)
        self.assertLessEqual(cowboy.stat().st_size, 220_000)
        self.assertEqual(ares.read_bytes(), (ROOT / "frontend" / "static" / "ares-chair.png").read_bytes())
        self.assertEqual(cowboy.read_bytes(), (ROOT / "frontend" / "static" / "bots" / "raijin-wait.png").read_bytes())


class RewriteContractTests(unittest.TestCase):
    def test_direction_set_and_helpers(self):
        from backend.agents.base import (
            ALL_DIRECTIONS,
            Direction,
            GOAL_CONTRACT,
            GOAL_CONTRACT_SHORT,
            ETH_GOAL_CONTRACT_SHORT,
            allows_simultaneous_legs,
            is_dual_display,
            is_wait,
            lean_side,
            side_of,
            signed_vote,
        )
        for name in (
            "UP", "DOWN", "WAIT", "SWAP",
            "LONG_UP", "LONG_DOWN", "REDUCE_UP", "REDUCE_DOWN",
            "FLAT_UP", "FLAT_DOWN", "FLAT_ALL", "BOTH",
            "UP_HOLD", "DOWN_HOLD",
        ):
            self.assertIn(name, ALL_DIRECTIONS)
        self.assertEqual(side_of("LONG_UP"), "UP")
        self.assertEqual(side_of("REDUCE_DOWN"), "DOWN")
        self.assertEqual(side_of("FLAT_UP"), "UP")
        self.assertIsNone(side_of("BOTH"))
        self.assertIsNone(side_of("WAIT"))
        self.assertEqual(lean_side("LONG_UP"), "UP")
        self.assertIsNone(lean_side("REDUCE_UP"))
        self.assertGreater(signed_vote("LONG_UP", 1.0), 0)
        self.assertLess(signed_vote("REDUCE_UP", 1.0), 0)
        self.assertTrue(is_wait("SIT"))
        self.assertTrue(is_dual_display("BOTH"))
        self.assertTrue(allows_simultaneous_legs("BOTH"))
        self.assertTrue(allows_simultaneous_legs("LONG_UP"))
        self.assertIn("path P&L", GOAL_CONTRACT)
        self.assertIn("Holding both sides", GOAL_CONTRACT)
        self.assertIn("No irreversible one-call", GOAL_CONTRACT)
        self.assertIn("path P&L", GOAL_CONTRACT_SHORT)
        self.assertIn("20–80¢", GOAL_CONTRACT_SHORT)
        self.assertIn("10–90¢", ETH_GOAL_CONTRACT_SHORT)
        self.assertIn("UP", getattr(Direction, "__args__", ("UP",)))

    def test_doctrine_kills_one_call_for_btc_15m(self):
        from backend.agents.base import GOAL_CONTRACT
        doctrine = (ROOT / "DOCTRINE.md").read_text(encoding="utf-8")
        self.assertIn("Path P&L", doctrine)
        self.assertIn("dead for BTC 15m", doctrine)
        self.assertIn("ETH 1H keeps it", doctrine)
        self.assertIn("Holding both sides", doctrine)
        self.assertIn("full 15 minutes", doctrine)
        self.assertIn("directional accuracy", doctrine.lower())
        self.assertIn("LONG_UP", doctrine)
        self.assertIn("irreversible` is false", doctrine)
        self.assertIn("Hard maxes beat Kelly", doctrine)
        self.assertIn("open_risk", doctrine)
        self.assertIn("keep gathering the full 15 minutes", doctrine)
        self.assertIn("Do NOT wire Follower", doctrine)
        # 9a8f20d was the old 20–80 one-lock / Kalshi-settle win. That is not done.
        self.assertNotIn("Specialists still vote `UP` / `DOWN` / `WAIT`.", doctrine)
        self.assertNotIn("exactly ONE high-quality directional guess", GOAL_CONTRACT)

    def test_sizing_respects_dual_scalp_and_clamps(self):
        from backend.risk.sizing import size_for_leader
        base = size_for_leader(
            edge_cents=8.0,
            p_finish=0.62,
            confidence=80,
            confluence=0.6,
            mid=42.0,
            spread=2.0,
            book_size=200,
            seconds_remaining=600,
            open_risk=0,
            is_scalp=False,
            is_dual_sided=False,
        )
        dual = size_for_leader(
            edge_cents=8.0,
            p_finish=0.62,
            confidence=80,
            confluence=0.6,
            mid=42.0,
            spread=2.0,
            book_size=200,
            seconds_remaining=600,
            open_risk=0,
            is_scalp=False,
            is_dual_sided=True,
        )
        scalp = size_for_leader(
            edge_cents=8.0,
            p_finish=0.62,
            confidence=80,
            confluence=0.6,
            mid=42.0,
            spread=2.0,
            book_size=200,
            seconds_remaining=600,
            open_risk=0,
            is_scalp=True,
            is_dual_sided=False,
        )
        self.assertGreater(base.stake, 0.0)
        self.assertLess(dual.stake, base.stake)
        self.assertLess(scalp.stake, base.stake)
        self.assertIn("dual", dual.reason)
        self.assertIn("scalp", scalp.reason)
        self.assertLessEqual(base.stake, float(settings.DYNAMIC_SIZING_MAX))
        self.assertGreaterEqual(base.stake, float(settings.DYNAMIC_SIZING_MIN))
        chalk = size_for_leader(mid=99.0, confidence=90, is_scalp=True)
        self.assertEqual(chalk.stake, 0.0)
        self.assertEqual(chalk.reason, "chalk_sit")
        huge = size_for_leader(
            edge_cents=40.0,
            p_finish=0.9,
            confidence=100,
            confluence=1.0,
            mid=40.0,
            hard_max=25.0,
        )
        self.assertLessEqual(huge.stake, 25.0)
        self.assertTrue(huge.clamped or huge.stake <= 25.0)
        blob = huge.to_dict()
        self.assertIn("stake", blob)
        self.assertIn("is_dual_sided", blob)
        self.assertIn("multipliers", blob)
        self.assertTrue(blob["hard_max_beats_kelly"])
        self.assertTrue(blob["open_risk_both_legs"])
        self.assertIsInstance(blob["reasons"], list)

    def test_negative_edge_add_is_not_clamp_min_d(self):
        from backend.risk.sizing import honor_sized_stake, size_for_leader
        out = size_for_leader(
            edge_cents=-8.0,
            p_finish=0.45,
            confidence=40,
            confluence=0.3,
            mid=48.0,
            spread=2.0,
            book_size=200,
            seconds_remaining=600,
            open_risk=0,
            is_scalp=True,
            is_dual_sided=False,
        )
        self.assertNotIn("clamp_min", out.reasons)
        self.assertIn("no_clamp_min_neg_edge", out.reasons)
        self.assertLess(out.stake, float(settings.DYNAMIC_SIZING_MIN))
        self.assertLessEqual(out.stake, out.raw_stake + 1e-9)
        self.assertGreater(out.stake, 0.0)
        self.assertEqual(honor_sized_stake(35.0, {"stake": 7.0}), 7.0)
        self.assertEqual(honor_sized_stake(7.0, {"stake": 7.0}), 7.0)
        self.assertLessEqual(honor_sized_stake(40.0, out), float(settings.DYNAMIC_SIZING_MAX))
        self.assertLessEqual(honor_sized_stake(40.0, {"stake": 7.0}), 7.0)

    def test_15m_locked_call_is_live_book_not_one_lock(self):
        from backend.agents.leader import Leader
        from backend.learning.btc15m_path import PathBook, PathLeg
        chair = Leader()
        tick = "KXBTC15M-26AUG162045-45"
        book = PathBook(ticker=tick)
        book.open_legs = [
            PathLeg(side="UP", entry_cents=42.0, stake=12.0),
            PathLeg(side="DOWN", entry_cents=41.0, stake=11.5),
        ]
        chair._path_books[tick] = book
        chair._locked_ticker = tick
        chair._last_path_action = "BOTH"
        chair._last_sizing = {"stake": 12.0, "is_dual_sided": True, "reason": "test"}
        chair._last_path_position = book.position_state(next_action="BOTH")
        lc = chair._build_locked_call()
        self.assertTrue(lc["locked"])
        self.assertFalse(lc["irreversible"])
        self.assertTrue(lc["path_book"])
        self.assertEqual(lc["direction"], "BOTH")
        self.assertIn("position", lc)
        self.assertGreater(lc["position"]["size_up"], 0)
        self.assertGreater(lc["position"]["size_down"], 0)
        self.assertEqual(lc["position"]["avg_up"], 42.0)
        self.assertEqual(lc["position"]["avg_down"], 41.0)
        self.assertTrue(lc["paper_only"])
        self.assertNotIn("FOLLOW THIS", json.dumps(lc))
        self.assertIn("path P&L", lc["goal"])

    def test_eth_locked_call_stays_one_lock(self):
        from backend.agents.leader import Leader
        chair = Leader()
        chair._set_window_lock("KXETHD-26AUG1616-T2000.00", "UP", 72, 0.8, up_pct=48.0, call_phase="entry")
        chair._locked_p_finish = 0.66
        lc = chair._build_locked_call()
        self.assertTrue(lc["locked"])
        self.assertTrue(lc["irreversible"])
        self.assertFalse(lc.get("path_book"))
        self.assertEqual(lc["direction"], "UP")
        self.assertIn("10–90¢", lc["goal"])
        self.assertNotIn("position", lc)

    def test_leader_overlay_carries_position_and_sizing(self):
        from backend.agents.leader import Leader
        chair = Leader()
        overlay = chair._apply_15m_path_book(
            ticker="KXBTC15M-26AUG101200-00",
            window_id="2026-08-10T16:00:00+00:00",
            lean="UP",
            conf=70,
            score=0.4,
            summary="lean UP",
            side_odds=48.0,
            up_pct=48.0,
            p_finish=0.6,
            ev_cents=6.0,
            regime_features={
                "asset": "btc",
                "ticker": "KXBTC15M-26AUG101200-00",
                "mins_left": 10.0,
                "window_minutes": 15.0,
                "yes_ask": 42.0,
                "no_ask": 42.0,
                "yes_bid": 40.0,
                "yes_mid": 41.0,
                "up_pct": 41.0,
                "kalshi_healthy": True,
            },
            gate_notes=[],
        )
        self.assertEqual(overlay["direction"], "BOTH")
        self.assertEqual(overlay["action"], "BOTH")
        self.assertIn("sizing", overlay)
        self.assertIn("stake", overlay["sizing"])
        self.assertTrue(overlay["sizing"]["is_dual_sided"])
        self.assertGreater(overlay["position"]["size_up"], 0)
        self.assertGreater(overlay["position"]["size_down"], 0)
        lc = chair._build_locked_call()
        self.assertFalse(lc["irreversible"])
        self.assertEqual(lc["position"]["size_up"], overlay["position"]["size_up"])

    def test_config_has_dynamic_sizing_clamps(self):
        self.assertTrue(settings.DYNAMIC_SIZING)
        self.assertEqual(settings.DYNAMIC_SIZING_MAX, 25.0)
        self.assertEqual(settings.DYNAMIC_SIZING_MIN, 5.0)
        self.assertEqual(settings.MAX_CALLS_PER_WINDOW, 1)


class SpecialistAndScoreboardTests(unittest.TestCase):
    def test_shape_path_signal_management_dirs(self):
        from backend.agents.base import AgentSignal, shape_path_signal
        md = {
            "ticker": "KXBTC15M-26AUG101200-00",
            "path_book": {},
            "path_quotes": {"chalk": False},
        }
        up = shape_path_signal(AgentSignal("volume", "UP", 70, "tape up", "volume"), md)
        self.assertEqual(up.direction, "LONG_UP")
        self.assertIn("path scalp", up.reasoning)
        self.assertNotIn("final direction", (up.reasoning or "").lower())
        cut = shape_path_signal(
            AgentSignal("volume", "DOWN", 70, "fade", "volume"),
            {
                "ticker": "KXBTC15M-26AUG101200-00",
                "path_book": {"size_up": 10.0, "size_down": 0.0},
                "path_quotes": {"chalk": False},
            },
        )
        self.assertIn(cut.direction, ("REDUCE_UP", "FLAT_UP"))
        chalk = shape_path_signal(
            AgentSignal("volume", "UP", 70, "lean", "volume"),
            {
                "ticker": "KXBTC15M-26AUG101200-00",
                "path_book": {"size_up": 8.0, "size_down": 8.0},
                "path_quotes": {"chalk": True},
            },
        )
        self.assertEqual(chalk.direction, "FLAT_ALL")
        eth = shape_path_signal(
            AgentSignal("volume", "UP", 70, "hourly lean", "volume"),
            {"ticker": "KXETHD-26AUG1616-T2000.00", "asset": "eth"},
        )
        self.assertEqual(eth.direction, "UP")
        self.assertNotIn("path scalp", eth.reasoning)

    def test_color_counts_long_not_reduce(self):
        from backend.agents.base import AgentSignal
        from backend.agents.chair_gates import color_counts_from_signals
        counts = color_counts_from_signals([
            AgentSignal("a", "LONG_UP", 70, "x", "c"),
            AgentSignal("b", "REDUCE_UP", 70, "x", "c"),
            AgentSignal("c", "LONG_DOWN", 70, "x", "c"),
        ])
        self.assertEqual(counts["UP"], 1)
        self.assertEqual(counts["DOWN"], 1)
        self.assertEqual(counts["WAIT"], 1)

    def test_open_risk_counts_both_legs(self):
        from backend.learning.btc15m_path import PathBook, PathLeg, open_risk_both_legs
        book = PathBook()
        book.open_legs = [
            PathLeg(side="UP", entry_cents=42.0, stake=12.0),
            PathLeg(side="DOWN", entry_cents=41.0, stake=11.5),
        ]
        self.assertEqual(open_risk_both_legs(book), 23.5)
        from backend.agents.leader import Leader
        chair = Leader()
        chair._path_books["KXBTC15M-26AUG101200-00"] = book
        snap = chair.path_book_snapshot("KXBTC15M-26AUG101200-00")
        self.assertEqual(snap["open_risk"], 23.5)
        self.assertGreater(snap["size_up"], 0)
        self.assertGreater(snap["size_down"], 0)

    def test_learn_from_path_pnl_credits_reduce(self):
        learner = AdaptiveLearner(asset="btc")
        votes = {"volume": {"direction": "REDUCE_UP", "confidence": 70}}
        learner.learn_from_path_pnl(votes, -5.0, {"UP"}, cut_sides={"UP"}, count_as_lock=False)
        self.assertGreater(learner.correct.get("volume", 0), 0)
        cold = AdaptiveLearner(asset="btc")
        cold.learn_from_path_pnl(votes, 8.0, {"UP"}, cut_sides=set(), count_as_lock=False)
        self.assertGreater(cold.wrong.get("volume", 0), 0)
        long_ok = AdaptiveLearner(asset="btc")
        long_ok.learn_from_path_pnl(
            {"candle_btc": {"direction": "LONG_UP", "confidence": 70}},
            4.0,
            {"UP"},
            count_as_lock=False,
        )
        self.assertGreater(long_ok.correct.get("candle_btc", 0), 0)

    def test_path_scoreboard_and_journal_status(self):
        from types import SimpleNamespace
        from backend.storage.db import PerformanceStore
        rows = [
            SimpleNamespace(
                ticker="KXBTC15M-26AUG101200-00",
                direction="UP",
                settle_reason="path_open",
                paper_pnl=2.0,
                paper_stake=10.0,
                close_time="2026-08-10T16:00:00+00:00",
                y_finish="DOWN",
                ev_cents=5.0,
                sizing=None,
                shadow=0,
                id=1,
                called_at="2026-08-10T15:50:00+00:00",
                settled_at="2026-08-10T16:00:00+00:00",
                actual_outcome="PATH",
                correct=None,
                paper_side="YES",
                entry_price=64000,
                open_price=42.0,
                exit_price=44.0,
                path_move_pct=2.0,
                win_pct=None,
                confidence=70,
                vetoed=0,
                side_ask=42.0,
                wait_reason=None,
                would_lock_if_strict=0,
                seat_split=None,
                book_depth=None,
                regime_key=None,
                p_finish=0.6,
                floor_strike=64000,
                asset="btc",
            ),
            SimpleNamespace(
                ticker="KXBTC15M-26AUG101200-00",
                direction="DOWN",
                settle_reason="path_dual",
                paper_pnl=1.5,
                paper_stake=10.0,
                close_time="2026-08-10T16:00:00+00:00",
                y_finish="DOWN",
                ev_cents=5.0,
                sizing=None,
                shadow=0,
                id=2,
                called_at="2026-08-10T15:50:00+00:00",
                settled_at="2026-08-10T16:00:00+00:00",
                actual_outcome="PATH",
                correct=None,
                paper_side="NO",
                entry_price=64000,
                open_price=41.0,
                exit_price=43.0,
                path_move_pct=2.0,
                win_pct=None,
                confidence=70,
                vetoed=0,
                side_ask=41.0,
                wait_reason=None,
                would_lock_if_strict=0,
                seat_split=None,
                book_depth=None,
                regime_key=None,
                p_finish=0.6,
                floor_strike=64000,
                asset="btc",
            ),
        ]
        windows = PerformanceStore._btc15m_windows_for_scorecard(rows)
        self.assertEqual(len(windows), 1)
        self.assertTrue(windows[0].dual_sided)
        self.assertGreater(windows[0].paper_pnl, 0)
        board = PerformanceStore._path_pnl_scoreboard(windows)
        self.assertEqual(board["score"], "realized_paper_pnl")
        self.assertEqual(board["dual"]["n"], 1)
        self.assertEqual(board["single"]["n"], 0)
        self.assertEqual(board["avg_edge_cents"], 5.0)
        self.assertFalse(PerformanceStore.paper_row_status(None, "PATH", "path_cut") == "loss")
        self.assertEqual(PerformanceStore.paper_row_status(None, "PATH", "path_cut"), "path")
        self.assertEqual(PerformanceStore.paper_row_status(None, None, None), "open")
        fin = PerformanceStore._finish_hit_secondary(windows)
        self.assertTrue(fin["secondary"])


if __name__ == "__main__":
    unittest.main()
