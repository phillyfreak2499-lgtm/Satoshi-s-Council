"""Regression tests for anonymous, paper-first personal process workspaces.

Bitcoin-only: fixtures use BTC + the canonical stances. The key doctrine
assertion — a journal entry never carries P&L — is preserved.
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.config import settings
from backend.storage.db import PerformanceStore


class WorkspaceStoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.previous_url = settings.DATABASE_URL
        self.previous_limit = settings.FREE_JOURNAL_LIMIT
        settings.DATABASE_URL = f"sqlite+aiosqlite:///{Path(self.tmp.name, 'workspace.db').as_posix()}"
        settings.FREE_JOURNAL_LIMIT = 2
        self.store = PerformanceStore()
        await self.store.init()
        self.account = await self.store.get_or_create_workspace_account(
            "b9f8bc8d-4c36-4c35-b1a0-2d0bde100001", "Process Tester"
        )

    async def asyncTearDown(self):
        await self.store.close()
        settings.DATABASE_URL = self.previous_url
        settings.FREE_JOURNAL_LIMIT = self.previous_limit
        self.tmp.cleanup()

    async def test_free_workspace_records_and_reflects_without_pnl(self):
        entry = await self.store.add_workspace_journal_entry(self.account["id"], {
            "asset": "btc", "stance": "WAIT", "horizon": "4h",
            "thesis": "The higher timeframes do not align yet.",
            "invalidation": "A confirmed 4h and 1d alignment changes the case.",
            "confluence_score": 1,
        })
        self.assertEqual(entry["stance"], "WAIT")
        reflected = await self.store.complete_workspace_journal_entry(
            self.account["id"], entry["id"], "Waited for the planned review instead of forcing activity."
        )
        self.assertEqual(reflected["status"], "reviewed")
        snapshot = await self.store.workspace_snapshot(self.account["id"])
        self.assertEqual(snapshot["process"]["reviewed_entries"], 1)
        # Doctrine: a personal process record never carries P&L.
        self.assertNotIn("pnl", snapshot["entries"][0])

    async def test_stance_is_canonical_and_asset_is_bitcoin(self):
        entry = await self.store.add_workspace_journal_entry(self.account["id"], {
            "asset": "btc", "stance": "Accumulate", "horizon": "1h",
            "thesis": "Bid is firm above the range low with intact structure.",
            "invalidation": "A clean 1h close back inside the range.",
        })
        self.assertEqual(entry["stance"], "ACCUMULATE")
        # A non-Bitcoin asset is rejected (BTC-only desk).
        with self.assertRaisesRegex(ValueError, "asset must be BTC"):
            await self.store.add_workspace_journal_entry(self.account["id"], {
                "asset": "sol", "stance": "Accumulate", "horizon": "1h",
                "thesis": "Not a Bitcoin call.", "invalidation": "n/a placeholder.",
            })

    async def test_weekly_process_score_and_free_limit_are_explicit(self):
        for _ in range(2):
            await self.store.add_workspace_journal_entry(self.account["id"], {
                "asset": "btc", "stance": "WAIT", "horizon": "1d",
                "thesis": "Bitcoin context is not complete yet.",
                "invalidation": "The next higher-timeframe close aligns all frames.",
            })
        with self.assertRaisesRegex(ValueError, "free journal limit"):
            await self.store.add_workspace_journal_entry(self.account["id"], {
                "asset": "btc", "stance": "WAIT", "horizon": "1h",
                "thesis": "This should not fit the free tier.",
                "invalidation": "A clear invalidation exists.",
            })
        review = await self.store.save_weekly_process_review(self.account["id"], {
            "horizon_named": True, "invalidation_named": True,
            "review_honored": True, "wait_respected": True,
        })
        self.assertEqual(review["score"], 100)


if __name__ == "__main__":
    unittest.main()
