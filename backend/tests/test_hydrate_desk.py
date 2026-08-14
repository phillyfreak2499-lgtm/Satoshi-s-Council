"""Cold-start desk hydrate: lifetime log is read, never wiped."""
from __future__ import annotations

import sys
import unittest
from unittest.mock import AsyncMock, MagicMock

# Council pulls the data pipeline + SQLAlchemy store; this env is paper-light.
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


class HydrateDeskTests(unittest.IsolatedAsyncioTestCase):
    def _council(self):
        from backend.services.council import Council
        return Council(asset="btc", leader_name="satoshi")

    def test_get_state_cold_marks_hydrating_without_empty_log(self):
        c = self._council()
        c.latest_state = {}
        st = c.get_state()
        self.assertTrue(st.get("hydrating"))
        acc = st.get("accuracy") or {}
        self.assertTrue(acc.get("hydrating"))
        self.assertNotIn("log", acc)
        self.assertNotIn("open", acc)
        self.assertEqual((st.get("decision") or {}).get("summary"), "Initializing...")

    async def test_hydrate_reads_store_and_does_not_clear(self):
        c = self._council()
        fake = {
            "correct": 3,
            "total": 5,
            "wrong": 2,
            "log": [{"direction": "UP", "correct": True}],
            "open": [],
            "recent": [{"direction": "UP", "correct": True}],
            "label": "3/5 · 60%",
        }
        c.store.get_accuracy = AsyncMock(return_value=dict(fake))
        c.store.clear_life_log = AsyncMock(side_effect=AssertionError("must not wipe life log"))
        c.store.clear_hit_rate = AsyncMock(side_effect=AssertionError("must not wipe hit rate"))
        seed = await c.hydrate_persisted_desk()
        acc = seed.get("accuracy") or {}
        self.assertEqual(acc.get("total"), 5)
        self.assertEqual(len(acc.get("log") or []), 1)
        self.assertTrue(acc.get("hydrated"))
        self.assertFalse(acc.get("hydrating"))
        self.assertFalse(seed.get("hydrating"))
        c.store.clear_life_log.assert_not_called()
        c.store.get_accuracy.assert_awaited()

    async def test_hydrate_does_not_clobber_live_analyze_payload(self):
        c = self._council()
        c.latest_state = {
            "decision": {"direction": "UP", "confidence": 72, "summary": "LEAN UP"},
            "accuracy": {
                "total": 9,
                "log": [{"direction": "DOWN"}],
                "hydrated": True,
            },
            "huddle": {"next_huddle_hint": "Next huddle in 2h"},
        }
        c.store.get_accuracy = AsyncMock(return_value={"total": 0, "log": []})
        out = await c.hydrate_persisted_desk()
        self.assertEqual((out.get("decision") or {}).get("summary"), "LEAN UP")
        self.assertEqual((out.get("accuracy") or {}).get("total"), 9)


if __name__ == "__main__":
    unittest.main()
