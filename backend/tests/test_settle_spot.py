"""Hour-close settle uses last good spot when this cycle's print is missing."""
from __future__ import annotations

import sys
import unittest
from unittest.mock import AsyncMock, MagicMock

from backend.agents.chair_gates import official_y_finish, tape_backfill_stats

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

    async def test_sweep_fetches_every_open_ticker_not_first_40(self):
        c = self._council()
        opens = [
            {"id": 100 + i, "ticker": f"KXBTCD-26AUG10{i:02d}-T60000.00"}
            for i in range(45)
        ]
        c.store.list_open_calls = AsyncMock(return_value=opens)

        class _Stub:
            def __init__(self):
                self.markets = []
                self.events = []

            async def get_event(self, event_ticker: str):
                self.events.append(event_ticker)
                return {
                    "event": {"event_ticker": event_ticker, "status": "determined"},
                    "markets": [{
                        "ticker": f"{event_ticker}-T60000.00",
                        "status": "finalized",
                        "result": "no",
                    }],
                }

            async def get_market(self, ticker: str):
                self.markets.append(ticker)
                return {"ticker": ticker, "status": "finalized", "result": "no"}

        stub = _Stub()
        c.pipeline = type("P", (), {"kalshi": stub})()
        results = await c._official_results_for_opens()
        self.assertGreaterEqual(len(stub.events), 45)
        self.assertEqual(len(stub.markets), 0)
        self.assertEqual(official_y_finish(results["KXBTCD-26AUG1000-T60000.00"]), "DOWN")
        self.assertEqual(official_y_finish(results["KXBTCD-26AUG1044-T60000.00"]), "DOWN")
        stats = tape_backfill_stats(opens, results)
        self.assertEqual(stats["open_n"], 45)
        self.assertEqual(stats["unique_tickers"], 45)
        self.assertEqual(stats["finalized_tickers"], 45)
        self.assertEqual(c._last_tape_backfill["open_n"], 45)
        self.assertEqual(c._last_tape_backfill["finalized_tickers"], 45)

    async def test_learn_from_settled_called_for_1062(self):
        c = self._council()
        c.store.recent_settled_calls = AsyncMock(return_value=[{
            "id": 1062,
            "ticker": "KXBTCD-26AUG1415-T62999.99",
            "y_finish": "DOWN",
            "actual_outcome": "DOWN",
            "outcome": "DOWN",
            "settle_reason": "finish_match",
            "agent_votes": {"candle": {"direction": "DOWN", "confidence": 70}},
            "regime": "US_PM_EARLY",
        }])
        c.learner.learn_from_settled = MagicMock(return_value={})
        c.learner.save = MagicMock()
        n = await c._learn_from_new_settlements()
        self.assertGreaterEqual(n, 1)
        c.learner.learn_from_settled.assert_called()
        self.assertEqual(c.learner.learn_from_settled.call_args[0][1], "DOWN")

    async def test_learn_from_settled_called_without_votes(self):
        c = self._council()
        c.store.recent_settled_calls = AsyncMock(return_value=[{
            "id": 1063,
            "ticker": "KXETHD-26AUG1415-T1874.99",
            "y_finish": "DOWN",
            "actual_outcome": "DOWN",
            "outcome": "DOWN",
            "settle_reason": "finish_miss",
            "agent_votes": {},
        }])
        c.learner.learn_from_settled = MagicMock(return_value={})
        c.learner.save = MagicMock()
        n = await c._learn_from_new_settlements()
        self.assertGreaterEqual(n, 1)
        c.learner.learn_from_settled.assert_called()

    async def test_start_loads_brain_and_does_not_rebuild(self):
        c = self._council()
        c.store.init = AsyncMock()
        c.store.recent_settled_calls = AsyncMock(return_value=[])
        c.learner.load = MagicMock(return_value=True)
        c.learner.rebuild_from_store = AsyncMock(return_value=99)
        c.hydrate_persisted_desk = AsyncMock(return_value={})
        c.sweep_official_finishes = AsyncMock(return_value=2)
        c.leader.sync_from_learner = MagicMock()
        c.pipeline.close = AsyncMock()
        c.store.close = AsyncMock()
        await c.start()
        try:
            c.learner.rebuild_from_store.assert_not_awaited()
            c.sweep_official_finishes.assert_awaited()
        finally:
            await c.stop()

    def test_save_refuses_to_shrink_brain(self):
        import json
        import tempfile
        from pathlib import Path
        from backend.learning.adaptive import AdaptiveLearner
        c = AdaptiveLearner(asset="btc")
        c.updates = 2
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "council-learning-btc.json"
            path.write_text(json.dumps({"updates": 17777, "weights": {"candle": 0.1}}), encoding="utf-8")
            c.save(path)
            disk = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(disk["updates"], 17777)


if __name__ == "__main__":
    unittest.main()
