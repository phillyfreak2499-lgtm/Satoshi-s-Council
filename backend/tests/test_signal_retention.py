"""Signal-table write dedup + retention keep the 2 GB disk from filling."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COUNCIL = (ROOT / "backend" / "services" / "council.py").read_text(encoding="utf-8")
DB = (ROOT / "backend" / "storage" / "db.py").read_text(encoding="utf-8")
DUAL = (ROOT / "backend" / "services" / "dual.py").read_text(encoding="utf-8")
MAIN = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
STATIC = ROOT / "frontend" / "static"


class SignalDedupTests(unittest.TestCase):
    def test_log_signal_is_deduped(self) -> None:
        self.assertIn("_last_sig_state", COUNCIL)
        self.assertIn("_last_sig_at", COUNCIL)
        # Dedup window and lock-transition capture must sit right by the guard.
        i = COUNCIL.index("_last_sig_state")
        block = COUNCIL[i - 400 : i + 400]
        self.assertIn("60.0", block)
        self.assertIn("window_locked", block)

    def test_keep_max_fits_the_disk(self) -> None:
        self.assertIn("keep_max: int = 25_000", DB)
        self.assertNotIn("keep_max: int = 150_000", DB)

    def test_periodic_in_loop_prune(self) -> None:
        self.assertIn("_last_signal_prune", DUAL)
        self.assertIn("prune_old_signals()", DUAL)


class DeadAssetsRemovedTests(unittest.TestCase):
    def test_leader_click_gone(self) -> None:
        self.assertFalse((STATIC / "leader-click.mp4").exists())
        self.assertNotIn("/leader-click.mp4", MAIN)

    def test_desk_b64_gone(self) -> None:
        self.assertEqual(list(STATIC.glob("desk-*.b64")), [])


if __name__ == "__main__":
    unittest.main()
