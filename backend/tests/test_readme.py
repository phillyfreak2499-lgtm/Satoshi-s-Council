"""README describes the dual 22-seat paper desk that is running."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class ReadmeTruthTests(unittest.TestCase):
    def test_readme_is_the_dual_desk(self) -> None:
        text = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("22", text)
        self.assertIn("Vitalik", text)
        self.assertIn("Satoshi", text)
        self.assertIn("public paper stream", text.lower())
        self.assertIn("satoshiscouncil.com", text)
        self.assertNotIn("four ranked advisors", text.lower())

    def test_audit_and_pivot_are_dated_archives(self) -> None:
        audit = (ROOT / "AUDIT.md").read_text(encoding="utf-8")
        pivot = (ROOT / "PIVOT.md").read_text(encoding="utf-8")
        self.assertTrue(audit.lower().startswith("# archived 2026-08-21"))
        self.assertTrue(pivot.lower().startswith("# archived 2026-08-21"))


if __name__ == "__main__":
    unittest.main()
