"""Binance/Coinbase spot health + CoinGlass key/parse. No live network, no real keys."""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Sibling tests may have mocked these; load the real modules for this file.
for _name in ("backend.data.binance", "backend.data.cfbenchmarks", "backend.data.coinglass"):
    mod = sys.modules.get(_name)
    if mod is None or isinstance(mod, MagicMock):
        sys.modules.pop(_name, None)

from loguru import logger

from backend.data.binance import (
    coinbase_product_for_symbol,
    snapshot_from_parts,
    spot_source_from_base,
)
from backend.data.cfbenchmarks import pick_research_spot, research_source_label
from backend.data.coinglass import (
    ALLOWED_INTERVALS,
    PATHS,
    CoinGlassClient,
    apply_hist_to_market,
    empty_derivatives,
    feeds_present,
    live_interval_order,
    summarize_derivatives,
)
from backend.data.secrets import load_coinglass_api_key, load_secret_string, reset_secret_cache
from backend.data.spot_health import research_spot_ok, spot_feed_ok, spot_source_label

ROOT = Path(__file__).resolve().parents[2]
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
FOLLOWER_PY = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
FOLLOWER_ROUTE = (ROOT / "backend" / "services" / "follower_route.py").read_text(encoding="utf-8")
FOLLOWER_JS = (ROOT / "frontend" / "protected" / "follower_gate.js").read_text(encoding="utf-8")
GATES = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CG_SRC = (ROOT / "backend" / "data" / "coinglass.py").read_text(encoding="utf-8")


class _FakeCG:
    def __init__(self, status_code, payload=None, text=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text if text is not None else json.dumps(self._payload)
        self.content = self.text.encode("utf-8")

    def json(self):
        return self._payload


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
        self.assertEqual(spot_source_label("BRTI"), "cfb")
        self.assertEqual(research_source_label("cfbenchmarks"), "cfb")
        self.assertTrue(research_spot_ok("vision"))
        self.assertTrue(research_spot_ok("cfb"))
        self.assertTrue(research_spot_ok("coinbase"))
        self.assertFalse(research_spot_ok("binance.us"))

    def test_vision_not_us_in_research_bases(self):
        src = (Path(__file__).resolve().parents[1] / "data" / "binance.py").read_text(encoding="utf-8")
        self.assertIn("https://data-api.binance.vision", src)
        self.assertIn("us_book_base = \"https://api.binance.us\"", src)
        self.assertIn("separate book", src)
        # us is labeled, not a vision fallback in spot_bases
        bases_block = src.split("self.spot_bases = [", 1)[1].split("]", 1)[0]
        self.assertIn("binance.vision", bases_block)
        self.assertNotIn("binance.us", bases_block)


class SpotFeedOkTests(unittest.TestCase):
    def test_coinbase_or_vision_counts(self):
        self.assertTrue(spot_feed_ok({"binance": False, "coinbase": True}))
        self.assertTrue(spot_feed_ok({"binance": False, "spot_source": "vision"}))
        self.assertTrue(spot_feed_ok({"binance": False, "cfb": True, "spot_source": "cfb"}))
        self.assertTrue(spot_feed_ok({}, {"candles": [{"c": 1}], "current_price": 99_000}))
        self.assertFalse(spot_feed_ok({"binance": False, "coinbase": False}, {}))

    def test_us_is_not_the_research_print(self):
        picked = pick_research_spot(vision=100_000, coinbase=99_900, binance_us=98_000)
        self.assertNotEqual(picked.get("source"), "binance.us")
        ranked = pick_research_spot(cfb_avg_60s=100_050, vision=100_000, coinbase=99_900)
        self.assertEqual(ranked["source"], "cfb")


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

    def test_secret_file_trailing_newline_still_authenticates(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "COINGLASS_API_KEY"
            path.write_text("file-dummy-not-real\n", encoding="utf-8")
            env = {"COINGLASS_API_KEY_FILE": str(path)}
            with patch.dict(os.environ, env, clear=False):
                os.environ.pop("COINGLASS_API_KEY", None)
                reset_secret_cache("COINGLASS_API_KEY")
                key = load_coinglass_api_key()
                cg = CoinGlassClient(symbol="BTCUSDT")
                headers = cg._headers()
            self.assertEqual(key, "file-dummy-not-real")
            self.assertIsNotNone(headers)
            self.assertEqual(headers["CG-API-KEY"], "file-dummy-not-real")
            self.assertNotIn("\n", headers["CG-API-KEY"])
            self.assertNotIn("\r", headers["CG-API-KEY"])

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
        daily = summarize_derivatives(
            [{"time": 1, "close": "0.00012"}],
            [{"time": 1, "close": "9000000000"}],
            [{"time": 1, "long_liquidation_usd": "4000000", "short_liquidation_usd": "1000000"}],
            "1d",
        )
        self.assertTrue(daily["daily_heatmap"])
        hourly = summarize_derivatives(
            [{"time": 1, "close": "0.00012"}],
            [{"time": 1, "close": "100"}, {"time": 2, "close": "110"}],
            [{"time": 1, "long_liquidation_usd": "1", "short_liquidation_usd": "1"}],
            "1h",
        )
        self.assertFalse(hourly["daily_heatmap"])
        self.assertAlmostEqual(hourly["oi_delta_1h"], 10.0)


class CoinGlassClientCycleTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        reset_secret_cache()

    def tearDown(self):
        reset_secret_cache()
        os.environ.pop("COINGLASS_API_KEY", None)

    def _client(self, key: str = "dummy-cg-key-not-real") -> CoinGlassClient:
        os.environ["COINGLASS_API_KEY"] = key
        reset_secret_cache("COINGLASS_API_KEY")
        return CoinGlassClient(symbol="BTCUSDT")

    def _capture_logs(self):
        buf = io.StringIO()
        hid = logger.add(buf, format="{message}")
        return buf, hid

    async def test_nonzero_code_logged_and_sets_reason(self):
        cg = self._client()
        payload = {"code": "400", "msg": "interval not allowed for your plan", "data": []}

        async def fake_get(url, params=None, headers=None):
            return _FakeCG(200, payload)

        cg.client.get = fake_get
        buf, hid = self._capture_logs()
        try:
            snap = await cg.get_derivatives()
        finally:
            logger.remove(hid)
        text = buf.getvalue()
        self.assertFalse(snap["healthy"])
        self.assertIn("400", str(snap.get("reason") or ""))
        self.assertIn("interval not allowed", str(snap.get("reason") or ""))
        self.assertIn("400", text)
        self.assertIn("interval not allowed", text)
        self.assertIn("/api/futures/funding-rate/history", text)
        self.assertIn("30m", text)
        self.assertNotIn("dummy-cg-key-not-real", text)
        rows = await cg._get_rows(PATHS[0], "30m")
        self.assertEqual(rows, [])
        self.assertTrue(cg._cycle_misses)

    async def test_30m_before_1h_never_1m(self):
        cg = self._client()
        seen: list[str] = []

        async def fake_get(url, params=None, headers=None):
            iv = str((params or {}).get("interval") or "")
            seen.append(iv)
            if iv == "30m":
                return _FakeCG(200, {
                    "code": "400",
                    "msg": "interval not allowed for your plan",
                    "data": [],
                })
            if iv == "1h":
                return _FakeCG(200, {
                    "code": "0",
                    "msg": "success",
                    "data": [{"time": 1_700_000_000_000, "close": "0.00012"}],
                })
            return _FakeCG(200, {"code": "0", "data": []})

        cg.client.get = fake_get
        snap = await cg.get_derivatives()
        self.assertNotIn("1m", seen)
        self.assertIn("30m", seen)
        self.assertIn("1h", seen)
        self.assertLess(seen.index("30m"), seen.index("1h"))
        self.assertEqual(live_interval_order(), ["30m", "1h"])
        self.assertEqual(ALLOWED_INTERVALS, ("30m", "1h"))
        self.assertTrue(snap["healthy"])
        self.assertIn("30m rejected", str(snap.get("reason") or ""))
        self.assertIn("using 1h", str(snap.get("reason") or ""))

    async def test_401_logs_without_key(self):
        secret = "SUPERSECRETKEYVALUE"
        cg = self._client(secret)

        async def fake_get(url, params=None, headers=None):
            self.assertEqual((headers or {}).get("CG-API-KEY"), secret)
            return _FakeCG(401, {"code": "401", "msg": "Invalid API key", "data": []})

        cg.client.get = fake_get
        buf, hid = self._capture_logs()
        try:
            snap = await cg.get_derivatives()
        finally:
            logger.remove(hid)
        text = buf.getvalue()
        self.assertFalse(snap["healthy"])
        self.assertIn("401", text)
        self.assertIn("401", str(snap.get("reason") or ""))
        self.assertNotIn(secret, text)
        self.assertNotIn(secret, str(snap.get("reason") or ""))
        self.assertNotIn("1m", text)

    async def test_v4_paths_and_params(self):
        cg = self._client()
        calls = []

        async def fake_get(url, params=None, headers=None):
            calls.append((url, dict(params or {}), dict(headers or {})))
            return _FakeCG(200, {"code": "0", "msg": "success", "data": [
                {"time": 1_700_000_000_000, "close": "1"},
            ]})

        cg.client.get = fake_get
        snap = await cg.get_derivatives()
        self.assertTrue(snap["healthy"])
        paths = [u.split("coinglass.com", 1)[-1] for u, _p, _h in calls]
        for path in PATHS:
            self.assertTrue(any(p.endswith(path) for p in paths), path)
        for _url, params, headers in calls:
            self.assertEqual(params.get("exchange"), "Binance")
            self.assertEqual(params.get("symbol"), "BTCUSDT")
            self.assertIn(params.get("interval"), ("30m", "1h"))
            self.assertNotEqual(params.get("interval"), "1m")
            self.assertEqual(headers.get("CG-API-KEY"), "dummy-cg-key-not-real")
            self.assertTrue(str(calls[0][0]).startswith("https://open-api-v4.coinglass.com"))


class HealthReasonTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_surfaces_coinglass_reason(self):
        from backend import main as m

        prev = m.council.running
        m.council.running = True
        try:
            with patch.object(
                m.council,
                "get_state",
                return_value={
                    "timestamp": "2026-08-15T21:00:00+00:00",
                    "tables": {
                        "bitcoin": {
                            "timestamp": "2026-08-15T21:00:00+00:00",
                            "health": {
                                "coinglass": False,
                                "coinglass_reason": (
                                    "path=/api/futures/funding-rate/history interval=30m "
                                    "symbol=BTCUSDT exchange=Binance http=401 code=401 "
                                    "msg=Invalid API key body="
                                ),
                                "kalshi": True,
                                "binance": True,
                            },
                        }
                    },
                },
            ):
                body = await m.health()
            self.assertFalse(body["coinglass_ok"])
            self.assertIn("401", body["coinglass_reason"])
            self.assertIn("30m", body["coinglass_reason"])
            self.assertNotIn("SUPERSECRET", str(body["coinglass_reason"]))
        finally:
            m.council.running = prev

    async def test_upgrade_plan_200_body_is_not_ok(self):
        from backend import main as m
        from backend.data.coinglass import coinglass_hud_ok

        self.assertFalse(coinglass_hud_ok(True, "http=200 code=401 msg=Upgrade plan"))
        self.assertFalse(coinglass_hud_ok(False, "http=200 code=401 msg=Upgrade plan"))
        self.assertTrue(coinglass_hud_ok(True, ""))
        prev = m.council.running
        m.council.running = True
        try:
            with patch.object(
                m.council,
                "get_state",
                return_value={
                    "timestamp": "2026-08-15T21:00:00+00:00",
                    "tables": {
                        "bitcoin": {
                            "timestamp": "2026-08-15T21:00:00+00:00",
                            "health": {
                                "coinglass": True,
                                "coinglass_reason": "http=200 code=401 msg=Upgrade plan",
                                "kalshi": True,
                                "binance": True,
                            },
                        }
                    },
                },
            ):
                body = await m.health()
            self.assertFalse(body["coinglass_ok"])
            self.assertIn("401", body["coinglass_reason"])
            self.assertIn("Upgrade plan", body["coinglass_reason"])
        finally:
            m.council.running = prev


class CoinGlassWireAndLeaveAloneTests(unittest.TestCase):
    def test_wire_note(self):
        self.assertIn("2026-08-15-coinglass-miss", WIRE_JS)
        self.assertIn("CoinGlass now logs the real miss + 30m/1h paths", WIRE_JS)
        self.assertIn("Follower OFF", WIRE_JS.split("2026-08-15-coinglass-miss", 1)[1][:400])
        self.assertNotIn("cancel", WIRE_JS.split("2026-08-15-coinglass-miss", 1)[1][:400].lower())

    def test_follower_untouched_and_floor_lock_only(self):
        self.assertNotIn("coinglass_reason", FOLLOWER_PY)
        self.assertNotIn("coinglass_reason", FOLLOWER_ROUTE)
        self.assertNotIn("coinglass_reason", FOLLOWER_JS)
        self.assertIn("def decide_open_lock_grade", GATES)
        self.assertIn("function floorSeatDirLocked(", JS)
        self.assertIn("function floorLockedAgents(", JS)
        self.assertIn("return floorLockedAgents(st.agents || [])", JS)

    def test_live_paths_never_request_1m(self):
        self.assertEqual(ALLOWED_INTERVALS, ("30m", "1h"))
        self.assertNotIn("1m", ALLOWED_INTERVALS)
        self.assertIn("/api/futures/funding-rate/history", CG_SRC)
        self.assertIn("/api/futures/open-interest/history", CG_SRC)
        self.assertIn("/api/futures/liquidation/history", CG_SRC)
        self.assertIn("CG-API-KEY", CG_SRC)
        self.assertIn("https://open-api-v4.coinglass.com", CG_SRC)
        self.assertIn("start_time", CG_SRC)
        self.assertIn("end_time", CG_SRC)


class CoinGlassHistReuseTests(unittest.IsolatedAsyncioTestCase):
    """Hist backfill reuses the live client. Does not require a real key."""

    def setUp(self):
        reset_secret_cache()

    def tearDown(self):
        reset_secret_cache()
        os.environ.pop("COINGLASS_API_KEY", None)

    async def test_no_key_returns_empty_without_http(self):
        with patch("backend.data.coinglass.load_coinglass_api_key", return_value=None):
            cg = CoinGlassClient(symbol="BTCUSDT")
            snap = await cg.get_historical_derivatives(1_700_000_000_000, 1_700_003_600_000)
        self.assertFalse(snap["healthy"])
        self.assertEqual(snap.get("skip_reason"), "no_key")
        self.assertFalse(feeds_present(snap)["funding"])

    async def test_empty_or_404_does_not_raise(self):
        os.environ["COINGLASS_API_KEY"] = "dummy-cg-key-not-real"
        reset_secret_cache("COINGLASS_API_KEY")
        cg = CoinGlassClient(symbol="BTCUSDT")

        async def empty_rows(*_a, **_k):
            return []

        with patch.object(cg, "_get_rows", side_effect=empty_rows):
            snap = await cg.get_historical_derivatives(1_700_000_000_000, 1_700_003_600_000)
        self.assertFalse(snap["healthy"])
        self.assertEqual(snap.get("skip_reason"), "empty_or_404")
        self.assertEqual(snap.get("missing_feeds"), ["funding", "open_interest", "liquidations"])

    async def test_hist_tries_30m_then_1h_never_1m(self):
        os.environ["COINGLASS_API_KEY"] = "dummy-cg-key-not-real"
        reset_secret_cache("COINGLASS_API_KEY")
        cg = CoinGlassClient(symbol="BTCUSDT")
        seen: list[str] = []

        async def rows(path, interval, limit=24, start_time=None, end_time=None):
            seen.append(interval)
            self.assertIn(path, PATHS)
            self.assertNotEqual(interval, "1m")
            if interval == "30m":
                return []
            if "funding" in path:
                return [{"time": 1_700_000_000_000, "close": "0.001"}]
            if "open-interest" in path:
                return [{"time": 1, "close": "100"}, {"time": 2, "close": "110"}]
            if "liquidation" in path:
                return [{
                    "time": 1,
                    "long_liquidation_usd": "8000000",
                    "short_liquidation_usd": "500000",
                }]
            return []

        with patch.object(cg, "_get_rows", side_effect=rows):
            snap = await cg.get_historical_derivatives(1_700_000_000_000, 1_700_003_600_000)
        self.assertIn("30m", seen)
        self.assertIn("1h", seen)
        self.assertNotIn("1m", seen)
        self.assertEqual(live_interval_order(), ["30m", "1h"])
        self.assertTrue(snap["healthy"])
        self.assertTrue(snap["feeds"]["funding"])
        md = apply_hist_to_market({"candles": []}, snap)
        self.assertAlmostEqual(md["funding_rate"], 0.001)
        self.assertAlmostEqual(md["open_interest"], 110)
        self.assertAlmostEqual(md["liq_long_usd"], 8_000_000)
        empty = empty_derivatives("30m")
        self.assertFalse(empty["healthy"])

    async def test_live_hist_skipped_without_opt_in(self):
        """No real key required. Live hist is opt-in; fixtures cover the three feeds."""
        if os.environ.get("COINGLASS_HIST_LIVE", "").strip().lower() not in ("1", "true", "yes"):
            self.skipTest("set COINGLASS_HIST_LIVE=1 to hit live CoinGlass; fixtures cover hist")
        if not load_coinglass_api_key():
            self.skipTest("COINGLASS_API_KEY missing")
        cg = CoinGlassClient(symbol="BTCUSDT")
        try:
            snap = await cg.get_historical_derivatives(1_700_000_000_000, 1_700_007_200_000)
        finally:
            await cg.close()
        self.assertIn("feeds", snap)


if __name__ == "__main__":
    unittest.main()
