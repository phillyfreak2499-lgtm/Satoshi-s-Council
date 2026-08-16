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
        self.assertEqual(EARLY_NO_LOCK_MINS_15M, 3.0)
        self.assertEqual(early_no_lock_mins_for(ticker="KXBTC15M-26AUG161200-00", asset="btc"), 3.0)
        self.assertEqual(early_no_lock_mins_for(ticker="KXETHD-26AUG1615-T2400", asset="eth"), 10.0)
        # First 3m of 15m blocked. Minute 4 is open. First 10m of 15m is NOT a sit.
        self.assertTrue(early_lock_blocked(13.0, 15.0, 3.0))   # 2m elapsed
        self.assertFalse(early_lock_blocked(11.0, 15.0, 3.0))  # 4m elapsed
        self.assertFalse(early_lock_blocked(5.0, 15.0, 3.0))   # would be blocked if we copied 1H 10m
        # ETH 1H still first 10m
        self.assertTrue(early_lock_blocked(55.0, 60.0, 10.0))
        self.assertFalse(early_lock_blocked(49.0, 60.0, 10.0))
        self.assertEqual(
            classify_wait_reason("WAIT · first 3m of the 15m — no lock"),
            "first_3m",
        )
        self.assertEqual(
            classify_wait_reason("WAIT · first 10m of the hour — no lock"),
            "first_10m",
        )

    def test_band_20_80_on_15m_10_90_on_eth(self):
        self.assertEqual(playable_band_cents_for(ticker="KXBTC15M-26AUG161200-00", asset="btc"), (20.0, 80.0))
        self.assertEqual(playable_band_cents(ticker="KXETHD-26AUG1615-T1", asset="eth"), (10.0, 90.0))
        self.assertTrue(playable_yes_mid(50, ticker="KXBTC15M-26AUG161200-00", asset="btc"))
        self.assertFalse(playable_yes_mid(12, ticker="KXBTC15M-26AUG161200-00", asset="btc"))
        self.assertFalse(playable_yes_mid(88, ticker="KXBTC15M-26AUG161200-00", asset="btc"))
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
        why = dead_book_reason(None, "UP", 15, ticker="KXBTC15M-26AUG161200-00", asset="btc")
        self.assertIn("20–80", why or "")

    def test_timeframe_gates_split(self):
        btc = timeframe_gates(ticker="KXBTC15M-26AUG161200-00", asset="btc")
        eth = timeframe_gates(ticker="KXETHD-26AUG1615-T1", asset="eth")
        self.assertEqual(btc["window_minutes"], 15.0)
        self.assertEqual(btc["early_no_lock_mins"], 3.0)
        self.assertEqual(btc["late_window_mins"], 2.5)
        self.assertEqual(btc["band_lo"], 20.0)
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
        self.assertFalse(dual_attractive(12.0, 12.0))
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

    def test_scale_cut_flip(self):
        from backend.learning.btc15m_path import PathBook, PathInputs, PathLeg, apply_fills, decide_action
        book = PathBook(ticker="KXBTC15M-X", open_legs=[PathLeg("UP", 48.0, 10.0)])
        scale = decide_action(PathInputs(6.0, 9.0, 53.0, 49.0, lean="UP", ev_cents=4.0), book)
        self.assertEqual(scale.action, "SCALE")
        cut_book = PathBook(ticker="KXBTC15M-X", open_legs=[PathLeg("UP", 48.0, 10.0)])
        cut = decide_action(PathInputs(6.0, 9.0, 42.0, 88.0, lean="UP", ev_cents=4.0), cut_book)
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
        late = decide_action(PathInputs(13.5, 1.5, 48.0, 52.0, lean="UP", ev_cents=3.0), book)
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
        self.assertIn("2026-08-16-btc-15m-path-pnl", WIRE)
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
        self.assertIn("Paper", chunk)
        self.assertIn("Follower OFF", chunk)
        self.assertIn("Live OFF", chunk)
        self.assertNotIn("ZT", chunk)
        self.assertNotIn("KX", chunk)

    def test_ui_labels(self):
        self.assertIn('id="ledWindowLabel">15M WINDOW', HTML)
        self.assertIn('id="chartPairTitle">BTC · 1m</span><span class="chart-window-chip">15M WINDOW</span>', HTML)
        self.assertIn('id="chartEthTitle">ETH · 1m</span><span class="chart-window-chip">1H WINDOW</span>', HTML)
        self.assertIn("function cryptoWindowLabel", JS)
        self.assertIn('return "15M WINDOW"', JS)
        self.assertIn('return "1H WINDOW"', JS)

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


if __name__ == "__main__":
    unittest.main()
