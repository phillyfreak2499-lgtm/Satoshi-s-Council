"""Binance/Coinbase spot health + CoinGlass key/parse. No live network, no real keys."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.modules.setdefault("httpx", MagicMock())

from backend.data.binance import (
    coinbase_product_for_symbol,
    snapshot_from_parts,
    spot_source_from_base,
)
from backend.data.coinglass import summarize_derivatives
from backend.data.secrets import load_secret_string, reset_secret_cache
from backend.data.spot_health import spot_feed_ok


class CoinbaseProductTests(unittest.TestCase):
    def test_eth_and_btc(self):
        self.assertEqual(coinbase_product_for_symbol("ETHUSDT"), "ETH-USD")
        self.assertEqual(coinbase_product_for_symbol("ethusd"), "ETH-USD")
        self.assertEqual(coinbase_product_for_symbol("BTCUSDT"), "BTC-USD")
        self.assertEqual(coinbase_product_for_symbol(None), "BTC-USD")


class SnapshotHealthTests(unittest.TestCase):
    def test_candles_mark_healthy_without_futures(self):
        snap = snapshot_from_parts(
            [{"close": 101_250.0}],
            {},
            {},
            "vision",
        )
        self.assertTrue(snap["healthy"])
        self.assertEqual(snap["current_price"], 101_250.0)
        self.assertEqual(snap["spot_source"], "vision")
        self.assertIsNone(snap["funding_rate"])

    def test_empty_unhealthy(self):
        snap = snapshot_from_parts([], {}, {}, None)
        self.assertFalse(snap["healthy"])
        self.assertEqual(snap["current_price"], 0.0)

    def test_source_labels(self):
        self.assertEqual(spot_source_from_base("https://data-api.binance.vision"), "vision")
        self.assertEqual(spot_source_from_base("https://api.binance.us"), "binance.us")
        self.assertEqual(spot_source_from_base("https://api.binance.com"), "binance.com")


class SpotFeedOkTests(unittest.TestCase):
    def test_coinbase_or_vision_counts(self):
        self.assertTrue(spot_feed_ok({"binance": False, "coinbase": True}))
        self.assertTrue(spot_feed_ok({"binance": False, "spot_source": "vision"}))
        self.assertTrue(spot_feed_ok({}, {"candles": [{"c": 1}], "current_price": 99_000}))
        self.assertFalse(spot_feed_ok({"binance": False, "coinbase": False}, {}))


class SecretLoadTests(unittest.TestCase):
    def tearDown(self):
        reset_secret_cache()

    def test_env_wins(self):
        with patch.dict(os.environ, {"UNIT_CG_KEY": "env-dummy-not-real"}, clear=False):
            val, src = load_secret_string("UNIT_CG_KEY", "UNIT_CG_KEY")
        self.assertEqual(src, "env")
        self.assertEqual(val, "env-dummy-not-real")

    def test_secret_file(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "COINGLASS_API_KEY"
            path.write_text("file-dummy-not-real\n", encoding="utf-8")
            env = {
                "UNIT_CG_KEY": "",
                "UNIT_CG_KEY_FILE": str(path),
            }
            with patch.dict(os.environ, env, clear=False):
                os.environ.pop("UNIT_CG_KEY", None)
                val, src = load_secret_string("UNIT_CG_KEY", "COINGLASS_API_KEY")
            self.assertEqual(src, "file")
            self.assertEqual(val, "file-dummy-not-real")

    def test_env_path_reads_file(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "COINGLASS_API_KEY"
            path.write_text("path-dummy-not-real", encoding="utf-8")
            with patch.dict(os.environ, {"UNIT_CG_KEY": str(path)}, clear=False):
                val, src = load_secret_string("UNIT_CG_KEY", "COINGLASS_API_KEY")
            self.assertEqual(src, "file")
            self.assertEqual(val, "path-dummy-not-real")


class CoinGlassParseTests(unittest.TestCase):
    def test_summarize_funding_oi_liq(self):
        snap = summarize_derivatives(
            [{"time": 1_700_000_000_000, "close": "0.00012"}],
            [{"time": 1_700_000_000_000, "close": "9000000000"}],
            [{
                "time": 1_700_000_000_000,
                "long_liquidation_usd": "4000000",
                "short_liquidation_usd": "1000000",
            }],
            "30m",
        )
        self.assertTrue(snap["healthy"])
        self.assertAlmostEqual(snap["funding_rate"], 0.00012)
        self.assertAlmostEqual(snap["open_interest"], 9_000_000_000)
        self.assertAlmostEqual(snap["liq_long_usd"], 4_000_000)
        self.assertAlmostEqual(snap["liq_net_usd"], -3_000_000)
        self.assertEqual(len(snap["funding_history"]), 1)


if __name__ == "__main__":
    unittest.main()
