"""Last-good desk snapshot: paint on boot, skip Oregon 451s, honest last-good."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
PIPELINE = (ROOT / "backend" / "data" / "pipeline.py").read_text(encoding="utf-8")
DUAL = (ROOT / "backend" / "services" / "dual.py").read_text(encoding="utf-8")
COUNCIL = (ROOT / "backend" / "services" / "council.py").read_text(encoding="utf-8")
ROUNDTABLE = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")


def _fat_state() -> dict:
    agents = []
    for i in range(22):
        agents.append({
            "agent_name": f"seat_{i}",
            "display_name": f"SEAT {i}",
            "direction": "WAIT" if i else "DOWN",
            "confidence": 40 + i,
            "reasoning": "x" * 800,
        })
    return {
        "timestamp": "2026-08-21T10:00:00+00:00",
        "asset": "btc",
        "leader_name": "satoshi",
        "decision": {"direction": "WAIT", "confidence": 72, "summary": "WAIT"},
        "agents": agents,
        "market": {
            "price": 77218.4,
            "funding": 0.0001,
            "oi": 30578,
            "mins_left": 9.5,
            "candles": [{"t": n, "c": 77000 + n} for n in range(80)],
        },
        "health": {
            "kalshi": True,
            "binance": True,
            "coinbase": False,
            "derivs_ok": True,
            "spot_source": "binance_vision",
        },
        "accuracy": {"correct": 1, "total": 2, "label": "1/2"},
    }


class DeskSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._env = patch.dict(os.environ, {"DATA_DIR": self._tmp.name})
        self._env.start()

    def tearDown(self) -> None:
        self._env.stop()
        self._tmp.cleanup()

    def test_paint_keeps_seats_and_price(self) -> None:
        from backend.services.desk_snapshot import paint_snapshot
        thin = paint_snapshot(_fat_state())
        self.assertIsNotNone(thin)
        self.assertEqual(len(thin["agents"]), 22)
        self.assertAlmostEqual(thin["market"]["price"], 77218.4)
        self.assertEqual(thin["market"]["funding"], 0.0001)
        self.assertEqual(len(thin["market"]["candles"]), 60)
        self.assertTrue(thin["last_good"])
        self.assertTrue(thin["from_snapshot"])
        self.assertTrue(thin["hydrating"])
        self.assertFalse(thin["health"]["binance"])
        self.assertFalse(thin["health"]["coinbase"])
        self.assertEqual(thin["health"]["spot_source"], "last_good")
        self.assertNotIn("reasoning", thin["agents"][0])

    def test_save_load_roundtrip(self) -> None:
        from backend.services.desk_snapshot import load_desk_snapshot, save_desk_snapshot, snapshot_path
        save_desk_snapshot("btc", _fat_state())
        path = snapshot_path("btc")
        self.assertTrue(path.is_file())
        body = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(len(body["agents"]), 22)
        loaded = load_desk_snapshot("btc")
        self.assertEqual(len(loaded["agents"]), 22)
        self.assertAlmostEqual(loaded["market"]["price"], 77218.4)
        self.assertTrue(loaded["last_good"])
        self.assertEqual(loaded["health"]["spot_source"], "last_good")

    def test_empty_state_is_not_saved(self) -> None:
        from backend.services.desk_snapshot import load_desk_snapshot, paint_snapshot, save_desk_snapshot
        self.assertIsNone(paint_snapshot({}))
        self.assertIsNone(paint_snapshot({"agents": [], "market": {}}))
        save_desk_snapshot("eth", {"agents": []})
        self.assertIsNone(load_desk_snapshot("eth"))

    def test_apply_seeds_pipeline_last_good(self) -> None:
        from backend.services.desk_snapshot import apply_snapshot_to_pipeline, paint_snapshot

        class Pipe:
            _last_good = None

        snap = paint_snapshot(_fat_state())
        pipe = Pipe()
        apply_snapshot_to_pipeline(pipe, snap)
        self.assertAlmostEqual(pipe._last_good["current_price"], 77218.4)
        self.assertTrue(pipe._last_good["last_good"])
        self.assertEqual(len(pipe._last_good["candles"]), 60)

    def test_last_good_does_not_count_as_live_spot(self) -> None:
        from backend.data.spot_health import spot_feed_ok
        from backend.services.desk_snapshot import paint_snapshot
        thin = paint_snapshot(_fat_state())
        self.assertFalse(spot_feed_ok(thin["health"], thin))
        self.assertFalse(spot_feed_ok(thin["health"], {"last_good": True, "price": 77218}))

    def test_hydrate_prefers_snapshot(self) -> None:
        self.assertIn("load_desk_snapshot", COUNCIL)
        self.assertIn("apply_snapshot_to_pipeline", COUNCIL)
        self.assertIn("save_desk_snapshot", COUNCIL)
        hydrate = COUNCIL.split("async def hydrate_persisted_desk", 1)[1]
        body = hydrate.split('"""', 2)[-1]
        self.assertLess(body.find("load_desk_snapshot"), body.find("get_accuracy"))
        self.assertIn("from_snapshot", body)
        self.assertIn("seats=", body)

    def test_boot_hydrates_both_tables_before_sweep(self) -> None:
        start = DUAL.split("async def start", 1)[1].split("def _councils", 1)[0]
        hyd = start.find("hydrate_persisted_desk")
        sweep = start.find("sweep_official_finishes")
        self.assertGreater(hyd, 0)
        self.assertGreater(sweep, hyd)
        # Two loops: paint every table, then sweep. ETH must not wait on BTC's closer.
        self.assertGreaterEqual(start.count("for c in self._councils()"), 2)

    def test_boot_starts_loop_before_closer(self) -> None:
        start = DUAL.split("async def start", 1)[1].split("def _councils", 1)[0]
        loop = start.find("create_task(self._loop())")
        sweep = start.find("sweep_official_finishes")
        self.assertGreater(loop, 0)
        self.assertGreater(sweep, 0)
        self.assertLess(loop, sweep)
        self.assertIn("boot-closers", start)
        self.assertIn("wait_for", start)
        self.assertIn("checkpoint_wal", DUAL)

    def test_official_closer_caps_kalshi_fetches(self) -> None:
        fn = COUNCIL.split("async def _official_results_for_opens", 1)[1].split(
            "def _grade_council_from_results", 1
        )[0]
        self.assertIn("MAX_EVENTS", fn)
        self.assertIn("limit=64", fn)
        self.assertIn("asset=self.asset", fn)


class GeoSkipTests(unittest.TestCase):
    def test_oregon_skips_binance_com_by_default(self) -> None:
        from backend.data.pipeline import geo_blocked
        self.assertTrue(geo_blocked("https://api.binance.com/api/v3/ticker/price"))
        self.assertTrue(geo_blocked("https://fapi.binance.com/fapi/v1/premiumIndex"))
        self.assertFalse(geo_blocked("https://data-api.binance.vision/api/v3/ticker/price"))
        self.assertFalse(geo_blocked("https://www.okx.com/api/v5/public/funding-rate"))
        self.assertFalse(geo_blocked("https://api.binance.us/api/v3/ticker/price"))
        self.assertFalse(geo_blocked("https://api.coinbase.com/v2/prices/BTC-USD/spot"))

    def test_fetch_builds_jobs_through_add(self) -> None:
        self.assertIn("def add(label: str, url: str", PIPELINE)
        self.assertIn("if geo_blocked(url):", PIPELINE)
        self.assertIn("_SKIP_COM", PIPELINE)
        self.assertIn("_note_451", PIPELINE)
        self.assertIn("TRY_BINANCE_COM", PIPELINE)


class WebpStillTests(unittest.TestCase):
    def test_fat_twins_are_webp(self) -> None:
        static = ROOT / "frontend" / "static"
        for name in ("ice", "frost", "fade", "bone", "glass", "hurt", "steam", "line", "pit", "mesh"):
            webp = static / "bots" / f"{name}.webp"
            self.assertTrue(webp.is_file(), name)
            self.assertLess(webp.stat().st_size, 80_000, name)
        self.assertTrue((static / "hive-egg.webp").is_file())
        self.assertLess((static / "hive-egg.webp").stat().st_size, 200_000)
        self.assertLess((static / "council-mark.png").stat().st_size, 80_000)
        self.assertIn("/static/bots/ice.webp", ROUNDTABLE)
        self.assertNotIn("/static/bots/" + "ice.png", ROUNDTABLE)
        self.assertIn("/chair-wait.webp", ROUNDTABLE)
        self.assertIn("/vitalik-wait.webp", ROUNDTABLE)
        self.assertIn("/oracle-wait.webp", ROUNDTABLE)


if __name__ == "__main__":
    unittest.main()
