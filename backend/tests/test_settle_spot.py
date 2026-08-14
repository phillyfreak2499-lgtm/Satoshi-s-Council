"""Hour-close settle uses last good spot when this cycle's print is missing."""
from __future__ import annotations

import sys
import unittest
from unittest.mock import AsyncMock, MagicMock

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

    async def test_settle_due_windows_passes_last_spot(self):
        c = self._council()
        c._last_spot = 97_500.0
        c.store.list_open_calls = AsyncMock(return_value=[])
        c.store.settle_expired_calls = AsyncMock(return_value=1)
        c._learn_from_new_settlements = AsyncMock(return_value=1)
        n = await c.settle_due_windows(current_price=0, up_pct=52, down_pct=48, floor_strike=97_000)
        self.assertEqual(n, 1)
        kwargs = c.store.settle_expired_calls.await_args.kwargs
        self.assertEqual(kwargs["current_price"], 97_500.0)
        self.assertEqual(kwargs["asset"], "btc")
        self.assertIn("kalshi_results", kwargs)
        c._learn_from_new_settlements.assert_awaited()

    async def test_settle_uses_persisted_spot_when_cycle_is_empty(self):
        c = self._council()
        c._last_spot = None
        c.store.list_open_calls = AsyncMock(return_value=[])
        c.store.settle_expired_calls = AsyncMock(return_value=1)
        c._learn_from_new_settlements = AsyncMock(return_value=1)
        c._load_persisted_spot = lambda: 62_100.0
        n = await c.settle_due_windows(current_price=None, up_pct=None, down_pct=None, floor_strike=62_999.99)
        self.assertEqual(n, 1)
        self.assertEqual(c.store.settle_expired_calls.await_args.kwargs["current_price"], 62_100.0)


if __name__ == "__main__":
    unittest.main()
