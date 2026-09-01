"""ETH now runs the real 15m KXETH15M book — same clock as BTC 15m.

These lock in that an ETH 15m ticker routes through the 15m gate profile
(3m early-no-lock, 15m window, 2.5m late) and NOT the old hourly copy
(10m early-no-lock, 60m window, 15m late) that would strangle a 15m book.
ETH 1H (KXETHD) and BTC 15m (KXBTC15M) behavior must be unchanged.

asset=eth with no ticker is KXETH15M (15m). Only KXETHD stays hourly.
This file must never be the literal word placeholder.
"""
from __future__ import annotations

import unittest
from pathlib import Path

from backend.learning.btc15m import (
    coinglass_allowed_on_book,
    early_no_lock_mins_for,
    is_15m_window,
    is_eth_15m_ticker,
    is_eth_1h_ticker,
    series_for_live_asset,
    timeframe_gates,
    window_minutes_for,
)
from backend.agents.chair_gates import ticker_asset
from backend.data.pipeline import DataPipeline
from backend.services.desk_pack import window_label_ct

ETH_15M = "KXETH15M-26AUG2213-T3500"
ETH_1H = "KXETHD-26AUG2214-T4600"
BTC_15M = "KXBTC15M-26AUG2213-T117249.99"


class NotAStubTests(unittest.TestCase):
    def test_this_file_is_not_a_placeholder(self) -> None:
        text = Path(__file__).read_text(encoding="utf-8")
        self.assertNotEqual(text.strip(), "placeholder-will-replace")
        self.assertGreater(len(text), 400)
        self.assertIn("class Eth15mRoutingTests", text)


class Eth15mRoutingTests(unittest.TestCase):
    def test_live_series_is_kxeth15m(self) -> None:
        self.assertEqual(series_for_live_asset("eth"), "KXETH15M")
        self.assertEqual(DataPipeline(asset="eth").series_ticker, "KXETH15M")

    def test_eth_15m_ticker_is_a_15m_window(self) -> None:
        self.assertTrue(is_eth_15m_ticker(ETH_15M))
        self.assertFalse(is_eth_1h_ticker(ETH_15M))
        self.assertTrue(is_15m_window(ticker=ETH_15M, asset="eth"))
        self.assertEqual(window_minutes_for(ticker=ETH_15M), 15.0)

    def test_eth_no_ticker_defaults_to_15m(self) -> None:
        self.assertTrue(is_15m_window(asset="eth"))
        self.assertEqual(window_minutes_for(asset="eth"), 15.0)
        self.assertEqual(early_no_lock_mins_for(asset="eth"), 3.0)
        g = timeframe_gates(asset="eth")
        self.assertEqual(g["window_minutes"], 15.0)
        self.assertEqual(g["early_no_lock_mins"], 3.0)
        self.assertEqual(g["late_window_mins"], 2.5)
        self.assertFalse(coinglass_allowed_on_book(asset="eth"))

    def test_eth_15m_uses_the_15m_timers_not_hourly(self) -> None:
        self.assertEqual(early_no_lock_mins_for(ticker=ETH_15M, asset="eth"), 3.0)
        g = timeframe_gates(ticker=ETH_15M, asset="eth")
        self.assertEqual(g["window_minutes"], 15.0)
        self.assertEqual(g["early_no_lock_mins"], 3.0)
        self.assertEqual(g["late_window_mins"], 2.5)
        self.assertNotEqual(g["window_minutes"], 60.0)
        self.assertNotEqual(g["early_no_lock_mins"], 10.0)

    def test_eth_15m_blocks_coinglass_1h_as_a_lock_feature(self) -> None:
        self.assertFalse(coinglass_allowed_on_book(ticker=ETH_15M, asset="eth"))

    def test_settlement_routes_eth_15m_to_eth(self) -> None:
        self.assertEqual(ticker_asset(ETH_15M), "eth")

    def test_window_label_span_is_15m_for_eth(self) -> None:
        self.assertEqual(window_label_ct("KXETH15M"), "15M")
        self.assertEqual(window_label_ct("KXETHD"), "1H")


class Regression1hAndBtcUnchangedTests(unittest.TestCase):
    def test_eth_1h_still_hourly(self) -> None:
        self.assertTrue(is_eth_1h_ticker(ETH_1H))
        self.assertFalse(is_15m_window(ticker=ETH_1H, asset="eth"))
        self.assertEqual(window_minutes_for(ticker=ETH_1H), 60.0)
        self.assertEqual(early_no_lock_mins_for(ticker=ETH_1H, asset="eth"), 10.0)
        self.assertEqual(ticker_asset(ETH_1H), "eth")

    def test_btc_15m_unchanged(self) -> None:
        self.assertTrue(is_15m_window(ticker=BTC_15M, asset="btc"))
        self.assertEqual(window_minutes_for(ticker=BTC_15M), 15.0)
        g = timeframe_gates(ticker=BTC_15M, asset="btc")
        self.assertEqual(g["window_minutes"], 15.0)
        self.assertEqual(g["early_no_lock_mins"], 3.0)
        self.assertEqual(ticker_asset(BTC_15M), "btc")


if __name__ == "__main__":
    unittest.main()
