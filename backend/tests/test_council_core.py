"""
Behavioural unit tests for the council's decision + honest-grading core.

The report card flagged that satoshi_call / council_final / settle_finish /
_committed_finish_rows / learn_from_settled — the most safety-critical and
most-recently-changed code — had ZERO direct tests. These are pure or
near-pure functions, so they are cheap to pin down. This suite exercises real
behaviour (not source-string greps).
"""
import unittest


class SideNormalisationTests(unittest.TestCase):
    """_side must read the scalp engine's LONG_* language (the un-starve fix)."""

    def test_long_and_hold_map_to_a_side(self):
        from backend.services.round_table import _side
        self.assertEqual(_side("UP"), "UP")
        self.assertEqual(_side("LONG_UP"), "UP")
        self.assertEqual(_side("UP_HOLD"), "UP")
        self.assertEqual(_side("DOWN"), "DOWN")
        self.assertEqual(_side("LONG_DOWN"), "DOWN")
        self.assertEqual(_side("DOWN_HOLD"), "DOWN")

    def test_wait_and_junk_have_no_side(self):
        from backend.services.round_table import _side
        self.assertIsNone(_side("WAIT"))
        self.assertIsNone(_side(""))
        self.assertIsNone(_side(None))
        self.assertIsNone(_side("SIDEWAYS"))


class SatoshiCallTests(unittest.TestCase):
    def _stance(self, name, direction, conf):
        return {"leader": name, "direction": direction, "confidence": conf}

    def test_strong_four_of_four_commits(self):
        from backend.services import round_table as rt
        stances = [self._stance("vitalik", "UP", 82), self._stance("ares", "UP", 80),
                   self._stance("raijin", "UP", 78), self._stance("oracle", "UP", 84)]
        out = rt.satoshi_call(list(stances), vetoes=[], cautions=[], structure=None, posture={})
        self.assertEqual(out["direction"], "UP")
        self.assertEqual(out["rule"], "confluence")

    def test_active_veto_forces_wait(self):
        from backend.services import round_table as rt
        stances = [self._stance("vitalik", "UP", 82), self._stance("ares", "UP", 80),
                   self._stance("raijin", "UP", 78), self._stance("oracle", "UP", 60)]
        veto = [{"leader": "oracle", "code": "risk_off", "reason": "vol"}]
        out = rt.satoshi_call(list(stances), vetoes=veto, cautions=[], structure=None, posture={})
        self.assertEqual(out["direction"], "WAIT")
        self.assertEqual(out["rule"], "veto")

    def test_dark_feed_caution_keeps_marginal_calls_disciplined(self):
        # feed_dark is a CAUTION now (not a veto): a marginal, low-conviction
        # confluence under a caution still tips to WAIT.
        from backend.services import round_table as rt
        cautions = rt.protective_cautions({"health": {"coinglass": False}, "market": {}, "coinglass": {}})
        self.assertTrue(any(c.get("code") == "feed_dark" for c in cautions))
        stances = [self._stance("vitalik", "UP", 22), self._stance("ares", "UP", 20),
                   self._stance("raijin", "WAIT", 0), self._stance("oracle", "WAIT", 0)]
        out = rt.satoshi_call(list(stances), vetoes=[], cautions=cautions, structure=None, posture={})
        self.assertEqual(out["direction"], "WAIT")


class CouncilFinalTests(unittest.TestCase):
    def test_garbage_tables_stand_down_never_raise(self):
        from backend.services.round_table import council_final
        for junk in (None, {}, {"agents": "notalist"}, {"agents": [123, None]}):
            out = council_final(junk)
            self.assertEqual(str(out.get("direction")).upper(), "WAIT")

    def test_feed_dark_never_appears_as_a_veto(self):
        from backend.services import round_table as rt
        t = {"health": {"coinglass": False}, "market": {}, "coinglass": {}}
        self.assertFalse(any(v.get("code") == "feed_dark" for v in rt.protective_vetoes(t)))


class CommittedFinishRowsTests(unittest.TestCase):
    def test_only_settler_graded_rows_survive(self):
        from backend.main import _committed_finish_rows
        rows = [
            {"correct": 1, "settle_reason": "finish_match"},
            {"correct": 0, "settle_reason": "finish_miss"},
            {"correct": None, "settle_reason": "chalk_skip"},   # old auto-win
            {"correct": None, "settle_reason": "path_flip"},     # old fabricated loss
            {"direction": "WAIT"},
        ]
        kept = _committed_finish_rows(rows)
        self.assertEqual(len(kept), 2)
        self.assertEqual({r["settle_reason"] for r in kept}, {"finish_match", "finish_miss"})

    def test_handles_none_and_empty(self):
        from backend.main import _committed_finish_rows
        self.assertEqual(_committed_finish_rows(None), [])
        self.assertEqual(_committed_finish_rows([]), [])


class SettleFinishTests(unittest.TestCase):
    def _log(self, rows):
        from backend.services.process_log import ProcessLog
        pl = ProcessLog(path=None)   # in-memory, no file writes
        pl._rows = rows
        return pl

    def test_directional_call_graded_against_finish(self):
        pl = self._log([{"ref": "T1", "call": "Accumulate", "side": "UP"}])
        self.assertTrue(pl.settle_finish("T1", "UP"))
        self.assertTrue(pl._rows[0]["correct"])
        self.assertEqual(pl._rows[0]["outcome"], "UP")

    def test_directional_miss(self):
        pl = self._log([{"ref": "T2", "call": "Accumulate", "side": "UP"}])
        pl.settle_finish("T2", "DOWN")
        self.assertFalse(pl._rows[0]["correct"])

    def test_stand_down_records_outcome_but_is_not_graded(self):
        pl = self._log([{"ref": "T3", "call": "Stand down", "side": "UP"}])
        pl.settle_finish("T3", "UP")
        self.assertIsNone(pl._rows[0]["correct"])   # sitting is never a miss
        self.assertEqual(pl._rows[0]["outcome"], "UP")

    def test_idempotent(self):
        pl = self._log([{"ref": "T4", "call": "Accumulate", "side": "UP"}])
        self.assertTrue(pl.settle_finish("T4", "UP"))
        self.assertFalse(pl.settle_finish("T4", "DOWN"))  # already graded — not re-graded
        self.assertTrue(pl._rows[0]["correct"])


class LearnFromSettledTests(unittest.TestCase):
    def test_long_direction_votes_are_graded(self):
        # The learner used to drop LONG_*/HOLD votes (require exact UP/DOWN),
        # silently ignoring the main directional voters. It must grade them now.
        from backend.learning.adaptive import AdaptiveLearner
        L = AdaptiveLearner()
        votes = {
            "momentum": {"direction": "LONG_UP", "confidence": 80},
            "strike": {"direction": "LONG_DOWN", "confidence": 75},
            "odds": {"direction": "UP", "confidence": 90},
        }
        L.learn_from_settled(votes, "UP", regime="US_PM_MID", credit=1.0)
        self.assertEqual(L.correct.get("momentum"), 1)   # LONG_UP vs UP -> correct
        self.assertEqual(L.correct.get("odds"), 1)
        self.assertEqual(L.wrong.get("strike"), 1)        # LONG_DOWN vs UP -> wrong


if __name__ == "__main__":
    unittest.main()
