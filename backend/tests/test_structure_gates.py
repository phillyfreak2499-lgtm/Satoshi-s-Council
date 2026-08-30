"""Session & structure gates — hard WAITs, fail-soft on missing data."""
from __future__ import annotations

import unittest

from backend.agents.structure_gates import (
    structure_stake_pct,
    structure_wait_code,
    structure_wait_reason,
)
from backend.agents.structure_hook import checklist_with_structure, install_structure_gates


class StructureWaits(unittest.TestCase):
    def test_chop_blocks(self):
        why = structure_wait_reason(regime="chop", lean="UP")
        self.assertEqual(why, "chop — no family inside range")
        self.assertEqual(structure_wait_code(why), "WAIT_CHOP")

    def test_too_late_blocks_new_risk(self):
        why = structure_wait_reason(mins_left=1.5, already_locked=False, lean="UP")
        self.assertEqual(why, "too late — no new call")
        self.assertEqual(structure_wait_code(why), "WAIT_TOO_LATE")

    def test_too_late_spares_open_book(self):
        why = structure_wait_reason(mins_left=1.5, already_locked=True, lean="UP")
        self.assertIsNone(why)

    def test_no_cushion_when_hugging_strike(self):
        why = structure_wait_reason(
            mins_left=10.0,
            spot=100000.0,
            strike=100020.0,
            atr_pct=0.40,
            lean="UP",
        )
        self.assertEqual(why, "no cushion vs strike")
        self.assertEqual(structure_wait_code(why), "WAIT_NO_CUSHION")

    def test_cushion_ok_when_far(self):
        why = structure_wait_reason(
            mins_left=10.0,
            spot=100000.0,
            strike=99000.0,
            atr_pct=0.40,
            lean="UP",
        )
        self.assertIsNone(why)

    def test_missing_spot_does_not_invent_cushion_veto(self):
        why = structure_wait_reason(mins_left=10.0, strike=100000.0, atr_pct=0.40)
        self.assertIsNone(why)

    def test_tape_disagrees(self):
        why = structure_wait_reason(lean="UP", buy_ratio=0.30)
        self.assertEqual(why, "tape disagrees with zone")
        self.assertEqual(structure_wait_code(why), "WAIT_TAPE")

    def test_tape_agrees_or_mixed_passes(self):
        self.assertIsNone(structure_wait_reason(lean="UP", buy_ratio=0.70))
        self.assertIsNone(structure_wait_reason(lean="UP", buy_ratio=0.50))
        self.assertIsNone(structure_wait_reason(lean="UP"))

    def test_midrange(self):
        why = structure_wait_reason(midrange=True)
        self.assertEqual(structure_wait_code(why), "WAIT_MIDRANGE")

    def test_chalk_still_wins(self):
        why = structure_wait_reason(chalk=True, regime="chop")
        self.assertEqual(why, "chalk book")
        self.assertEqual(structure_wait_code(why), "WAIT_CHALK")


class StakePct(unittest.TestCase):
    def test_base_and_cap(self):
        self.assertEqual(structure_stake_pct(), 2.5)
        self.assertEqual(
            structure_stake_pct(completeness=90, tape_agrees=True, zone_agrees=True),
            5.0,
        )
        self.assertEqual(
            structure_stake_pct(
                completeness=90, tape_agrees=True, zone_agrees=True, session_grade="worse"
            ),
            2.5,
        )


class HookKeepsChalkFirst(unittest.TestCase):
    def test_existing_chalk_still_refuses(self):
        ok, why = checklist_with_structure(
            spot_ok=True,
            kalshi_ok=True,
            law_locked=False,
            chalk=True,
            leftover_cents=8.0,
            is_15m=True,
            quiet=False,
            hard_trigger=True,
            families_aligned=2,
            regime_features={"mins_left": 9},
            lean="UP",
        )
        self.assertFalse(ok)
        self.assertEqual(why, "chalk book")

    def test_structure_fires_after_checklist_pass(self):
        ok, why = checklist_with_structure(
            spot_ok=True,
            kalshi_ok=True,
            law_locked=False,
            chalk=False,
            leftover_cents=8.0,
            is_15m=True,
            quiet=False,
            hard_trigger=True,
            families_aligned=2,
            regime_features={"regime": "consolidation", "mins_left": 9},
            lean="UP",
        )
        self.assertFalse(ok)
        self.assertIn("chop", why)

    def test_install_is_idempotent(self):
        install_structure_gates()
        install_structure_gates()


if __name__ == "__main__":
    unittest.main()
