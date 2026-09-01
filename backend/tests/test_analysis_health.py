"""Frozen seats must be visible: cycle + analysis_ok_at reach /health and feed health."""
from __future__ import annotations

import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

from backend.services.feed_health import build_feed_health

ROOT = Path(__file__).resolve().parents[2]
DUAL = (ROOT / "backend" / "services" / "dual.py").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _state(health: dict) -> dict:
    return {
        "running": True,
        "fetched_at": time.time(),
        "tables": {
            "bitcoin": {
                "health": health,
                "market": {"price": 78000.0, "up_pct": 47.0, "kalshi_ticker": "KXBTC15M-TEST"},
                "coinglass": {},
            },
            "ethereum": None,
        },
    }


class AnalysisFeedRowTests(unittest.TestCase):
    def test_failing_cycle_marks_analysis_down(self) -> None:
        out = build_feed_health(_state({"binance": True, "kalshi": True, "cycle": "error"}))
        row = next(f for f in out["feeds"] if f["key"] == "analysis")
        self.assertEqual(row["state"], "down")
        self.assertTrue(row["critical"])
        self.assertIn("frozen", row["detail"])
        self.assertEqual(out["overall"], "down")

    def test_recent_ok_cycle_is_live(self) -> None:
        out = build_feed_health(_state({
            "binance": True, "kalshi": True, "quote_age_s": 2.0,
            "cycle": "ok", "analysis_ok_at": _iso_now(),
        }))
        row = next(f for f in out["feeds"] if f["key"] == "analysis")
        self.assertEqual(row["state"], "live")

    def test_transient_flap_with_fresh_ok_stays_soft(self) -> None:
        # One lock_busy tick seconds after a completed pass must not scream down.
        out = build_feed_health(_state({
            "binance": True, "kalshi": True,
            "cycle": "lock_busy", "analysis_ok_at": _iso_now(),
        }))
        row = next(f for f in out["feeds"] if f["key"] == "analysis")
        self.assertEqual(row["state"], "stale")

    def test_legacy_state_without_cycle_does_not_false_alarm(self) -> None:
        out = build_feed_health(_state({"binance": True, "kalshi": True}))
        row = next(f for f in out["feeds"] if f["key"] == "analysis")
        self.assertEqual(row["state"], "live")


class HealthExposureTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_carries_cycle_and_ok_age(self) -> None:
        from backend import main as m

        body = await m.health()
        self.assertIn("btc_cycle", body)
        self.assertIn("eth_cycle", body)
        self.assertIn("analysis_ok_age_s", body)


class SourceGuardTests(unittest.TestCase):
    def test_touch_stamps_ok_only(self) -> None:
        self.assertIn('if reason == "ok":', DUAL)
        self.assertIn('health["analysis_ok_at"] = iso', DUAL)

    def test_force_analyze_cannot_hold_the_lock_forever(self) -> None:
        block = MAIN.split("async def force_analyze", 1)[1].split("def _clamp_limit", 1)[0]
        self.assertIn("asyncio.wait_for(council.analyze_once()", block)
        self.assertIn("504", block)

    def test_strip_paints_stalled(self) -> None:
        self.assertIn('"STALLED"', JS)
        self.assertIn("btc_cycle", JS)


if __name__ == "__main__":
    unittest.main()
