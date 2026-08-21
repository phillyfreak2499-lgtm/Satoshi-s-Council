"""Public proof ledger is a cached summary, not a 5k-row N+1 scan."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
DB = (ROOT / "backend" / "storage" / "db.py").read_text(encoding="utf-8")

from backend.services.proof_cache import summarize_proof_rows


class ProofCacheTests(unittest.TestCase):
    def test_endpoint_uses_cache_not_fat_scan(self) -> None:
        self.assertIn("get_proof_summary", MAIN)
        self.assertNotIn("recent_settled_calls(limit=5000", MAIN)
        self.assertIn("proof_ledger_rows", DB)
        self.assertIn("refresh_proof", DB)
        self.assertNotIn("agent_votes", DB.split("async def proof_ledger_rows", 1)[1].split("async def recent_settled_calls", 1)[0])

    def test_summarize_skips_ungraded_and_counts_wait(self) -> None:
        body = summarize_proof_rows([
            {"direction": "WAIT", "correct": None, "regime_key": "15m"},
            {"direction": "UP", "correct": 1, "regime_key": "15m"},
            {"direction": "DOWN", "correct": 0, "regime_key": "1h"},
            {"direction": "UP", "correct": None, "regime_key": "15m"},
        ])
        self.assertEqual(body["wait_records"], 1)
        self.assertEqual(body["decision_records"], 3)
        self.assertEqual(body["evaluation"]["evaluated_directional_n"], 2)
        self.assertEqual(body["evaluation"]["wait_reviewed_n"], 1)
        self.assertEqual(body["evaluation"]["by_horizon"]["15m"]["n"], 1)
        self.assertEqual(body["evaluation"]["by_horizon"]["15m"]["correct"], 1)
        self.assertEqual(body["evaluation"]["by_horizon"]["1h"]["correct"], 0)
        self.assertEqual(body["records_by_asset"]["BTC"], 3)
        self.assertIn("not an edge claim", body["note"])


if __name__ == "__main__":
    unittest.main()
