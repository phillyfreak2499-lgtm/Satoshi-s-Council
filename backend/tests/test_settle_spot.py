"""Hour-close settle uses last good spot when this cycle's print is missing."""
from __future__ import annotations

import sys
import unittest
from unittest.mock import AsyncMock, MagicMock

from backend.agents.chair_gates import official_y_finish

sys.modules.setdefault("httpx", MagicMock())
sys.modules.setdefault("tenacity", MagicMock())
sys.modules.setdefault("sqlalchemy", MagicMock())
sys.modules.setdefault("sqlalchemy.ext", MagicMock())
sys.modules.setdefault("sqlalchemy.ext.asyncio", MagicMock())
sys.modules.setdefault("sqlalchemy.orm", MagicMock())
sys.modules.setdefault("backend.data.binance", MagicMock())
sys.modules.setdefault("backend.data.kalshi", MagicMock())
sys.modules.setdefault("backend.data.pipeline", MagicMock())
sys.modules.setdefault("backend.storage.db", MagicMock())
sys.modules.setdefault("backend.storage", MagicMock())


class SettleSpotTests(unittest.IsolatedAsyncioTestCase):
    def _council(self):
        from backend.services.council import Council
        return Council(asset="btc", leader_name="satoshi")

    def test_usable_spot_caches_and_falls_back(self):
        c = self._council()
        self.assertEqual(c._usable_spot(101_250), 101_250)
        self.assertEqual(c._last_spot, 101_250)
        self.assertEqual(c._usable_spot(0), 101_250)
        self.assertEqual(c._usable_spot(None), 101_250)
        self.assertEqual(c._usable_spot(-1), 101_250)

    async def test_settle_due_windows_passes_official_results_not_later_spot(self):
        c = self._council()
        c._last_spot = 97_500.0
        c.store.list_open_calls = AsyncMock(return_value=[{
            "id": 1062,
            "ticker": "KXBTCD-26AUG1415-T62999.99",
            "close_time": "2026-08-14T19:00:00+00:00",
        }])
        c.store.settle_expired_calls = AsyncMock(return_value=1)
        c._learn_from_new_settlements = AsyncMock(return_value=1)
        n = await c.settle_due_windows(current_price=99_999, up_pct=52, down_pct=48, floor_strike=97_000)
        self.assertEqual(n, 1)
        kwargs = c.store.settle_expired_calls.await_args.kwargs
        self.assertIsNone(kwargs["current_price"])
        self.assertIsNone(kwargs["asset"])
        results = kwargs["kalshi_results"]
        self.assertEqual((results.get("KXBTCD-26AUG1415-T62999.99") or {}).get("result"), "no")
        c._learn_from_new_settlements.assert_awaited()

    async def test_sweep_backfills_1062_and_learns(self):
        c = self._council()
        c.store.list_open_calls = AsyncMock(return_value=[{
            "id": 1062,
            "ticker": "KXBTCD-26AUG1415-T62999.99",
        }])
        c.store.settle_expired_calls = AsyncMock(return_value=1)
        c._learn_from_new_settlements = AsyncMock(return_value=1)
        n = await c.sweep_official_finishes()
        self.assertEqual(n, 1)
        results = c.store.settle_expired_calls.await_args.kwargs["kalshi_results"]
        self.assertEqual(official_y_finish(results[1062]), "DOWN")
        self.assertIsNone(c.store.settle_expired_calls.await_args.kwargs["current_price"])
        self.assertIsNone(c.store.settle_expired_calls.await_args.kwargs["asset"])
        c._learn_from_new_settlements.assert_awaited()

    async def test_sweep_backfills_1063_from_official_no(self):
        c = self._council()
        c.asset = "eth"
        c.store.list_open_calls = AsyncMock(return_value=[{
            "id": 1063,
            "ticker": "KXETHD-26AUG1415-T1874.99",
        }])
        c.store.settle_expired_calls = AsyncMock(return_value=1)
        c._learn_from_new_settlements = AsyncMock(return_value=1)
        n = await c.sweep_official_finishes()
        self.assertEqual(n, 1)
        results = c.store.settle_expired_calls.await_args.kwargs["kalshi_results"]
        self.assertEqual(official_y_finish(results[1063]), "DOWN")
        self.assertEqual((results.get("KXETHD-26AUG1415-T1874.99") or {}).get("result"), "no")
        c._learn_from_new_settlements.assert_awaited()

    async def test_flap_does_not_clobber_known_official(self):
        c = self._council()
        c.store.list_open_calls = AsyncMock(return_value=[{
            "id": 1062,
            "ticker": "KXBTCD-26AUG1415-T62999.99",
        }])
        c.pipeline = MagicMock()
        c.pipeline.kalshi.get_market = AsyncMock(return_value={
            "status": "active",
            "ticker": "KXBTCD-26AUG1415-T62999.99",
        })
        results = await c._official_results_for_opens()
        self.assertEqual(official_y_finish(results["KXBTCD-26AUG1415-T62999.99"]), "DOWN")
        self.assertEqual(official_y_finish(results[1062]), "DOWN")


if __name__ == "__main__":
    unittest.main()
