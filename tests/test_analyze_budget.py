"""Keep analyze_once under its 15s budget: bound the CoinGlass call and the settle scan.

Two steady-state hangs, both confirmed by tracing the per-cycle path:
  1. pipeline.fetch awaited a degraded CoinGlass (3 sequential HTTP calls) with
     no timeout wrapper, so a slow derivs feed could eat the whole budget.
  2. settle_expired_calls re-loaded the entire unsettled-window backlog every
     cycle; a disk-full outage left a pile of ungradeable past-due windows that
     never drain, growing the per-cycle cost without bound.
"""
from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from backend.config import settings
from backend.storage.db import PerformanceStore, WindowCall, SETTLE_SCAN_LIMIT

ROOT = Path(__file__).resolve().parents[2]
PIPELINE = (ROOT / "backend" / "data" / "pipeline.py").read_text(encoding="utf-8")
DB = (ROOT / "backend" / "storage" / "db.py").read_text(encoding="utf-8")


class CoinGlassBoundedTests(unittest.TestCase):
    def test_coinglass_call_is_time_capped(self):
        block = PIPELINE.split("client = CoinGlassClient", 1)[1][:400]
        self.assertIn("asyncio.wait_for", block)
        self.assertIn("get_historical_derivatives()", block)
        self.assertIn("_CG_BUDGET_S", block)
        self.assertIn("_CG_BUDGET_S = ", PIPELINE)

    def test_budget_is_well_under_analyze_cap(self):
        # The cap must leave room for the rest of the cycle inside 15s.
        import backend.data.pipeline as p
        self.assertLessEqual(p._CG_BUDGET_S, 6.0)


class SettleScanBoundedTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.previous_url = settings.DATABASE_URL
        settings.DATABASE_URL = f"sqlite+aiosqlite:///{Path(self.tmp.name, 'settle.db').as_posix()}"
        self.store = PerformanceStore()
        await self.store.init()

    async def asyncTearDown(self):
        await self.store.close()
        settings.DATABASE_URL = self.previous_url
        self.tmp.cleanup()

    def test_scan_is_bounded_in_source(self):
        block = DB.split("async def settle_expired_calls", 1)[1][:2000]
        self.assertIn("SETTLE_SCAN_LIMIT", block)
        self.assertIn(".order_by(WindowCall.id.desc())", block)
        self.assertIn(".limit(SETTLE_SCAN_LIMIT)", block)
        self.assertGreaterEqual(SETTLE_SCAN_LIMIT, 100)

    async def test_bounded_scan_executes_and_grades_nothing_without_results(self):
        # The new query must run cleanly against real SQLite and, with no
        # official Kalshi results, settle nothing (finish-only grading intact).
        now = datetime.now(timezone.utc).isoformat()
        async with self.store.Session() as sess:
            for i in range(5):
                sess.add(WindowCall(
                    ticker=f"KXBTC15M-SCAN-T{i}", direction="WAIT", confidence=60,
                    called_at=now, close_time=now, actual_outcome=None, asset="btc",
                ))
            await sess.commit()
        settled = await self.store.settle_expired_calls(asset="btc", kalshi_results={})
        self.assertEqual(settled, 0)
        # All five remain unsettled — none had an official result.
        from sqlalchemy import select, func
        async with self.store.Session() as sess:
            open_n = (await sess.execute(
                select(func.count(WindowCall.id)).where(WindowCall.actual_outcome.is_(None))
            )).scalar()
        self.assertEqual(open_n, 5)


if __name__ == "__main__":
    unittest.main()
