"""Herald live specialist audit — nine wire/quorum/scorecard honesty fixes."""
from __future__ import annotations

import asyncio
import unittest
from pathlib import Path

from backend.agents.base import AgentSignal
from backend.agents.chair_gates import (
    apply_hard_mute_to_signals,
    chair_ticker_blocked,
    chair_top_dir_eligible,
    classify_wait_reason,
    color_counts_from_signals,
    far_otm_companion,
    floor_scorecard,
    quorum_peer_dirs,
    seat_settle_key,
    stamp_signal_settle_keys,
    unique_agent_votes,
)
from backend.agents.leader import Leader
from backend.agents.spotlag import SpotLagSpecialist
from backend.agents.whale import WhaleSpecialist
from backend.data.coinglass import PLAN_WALL_REASON
from backend.learning.adaptive import AdaptiveLearner

ROOT = Path(__file__).resolve().parents[2]
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
CG_SRC = (ROOT / "backend" / "data" / "coinglass.py").read_text(encoding="utf-8")


def _sig(name: str, direction: str = "UP", conf: int = 70, **flags) -> AgentSignal:
    s = AgentSignal(name, direction, conf, "test", name)
    for k, v in flags.items():
        setattr(s, k, v)
    return s


class MuteOnWireTests(unittest.TestCase):
    def test_hard_mute_copies_onto_live_signal(self):
        learner = AdaptiveLearner(asset="btc")
        learner.correct["cheap"] = 10
        learner.wrong["cheap"] = 90
        learner.correct["candle"] = 80
        learner.wrong["candle"] = 20
        learner.correct["panic"] = 8
        learner.wrong["panic"] = 22
        cheap = _sig("cheap", "UP", 86)
        candle = _sig("candle", "UP", 70)
        panic = _sig("panic", "DOWN", 60)
        apply_hard_mute_to_signals([cheap, candle, panic], learner)
        self.assertTrue(cheap.hard_mute)
        self.assertTrue(cheap.muted)
        self.assertTrue(cheap.to_dict()["muted"])
        self.assertTrue(cheap.to_dict()["hard_mute"])
        self.assertFalse(candle.muted)
        self.assertFalse(candle.hard_mute)
        self.assertTrue(panic.faded)
        self.assertTrue(panic.invert)
        self.assertFalse(panic.hard_mute)
        self.assertFalse(panic.muted)

    def test_quorum_and_color_counts_drop_faded_invert_hard_mute(self):
        cheap = _sig("cheap", "UP", 86, muted=True, hard_mute=True)
        panic = _sig("panic", "DOWN", 60, faded=True, invert=True)
        candle = _sig("candle", "UP", 70)
        wick = _sig("volume", "UP", 60)
        peers = quorum_peer_dirs([cheap, panic, candle, wick], {})
        self.assertNotIn("cheap", peers)
        self.assertNotIn("panic", peers)
        self.assertEqual(peers["candle"], "UP")
        self.assertEqual(peers["volume"], "UP")
        counts = color_counts_from_signals([cheap, panic, candle, wick])
        self.assertEqual(counts["UP"], 2)
        self.assertEqual(counts["DOWN"], 0)
        self.assertEqual(counts["total"], 2)


class ScorecardChairVsShadowTests(unittest.TestCase):
    def test_chair_scorecard_ignores_shadow_bins(self):
        sc = floor_scorecard(
            {"correct": 1, "wrong": 2, "btc_shadow": {"n": 5, "hits": 5, "wrong": 0}},
            {"correct": 0, "wrong": 0, "eth_shadow": {"n": 5, "hits": 5, "wrong": 0}},
        )
        self.assertEqual(sc["btc"]["correct"], 1)
        self.assertEqual(sc["btc"]["wrong"], 2)
        self.assertEqual(sc["eth"]["correct"], 0)
        self.assertEqual(sc["eth"]["wrong"], 0)
        self.assertEqual(sc["btc_text"], "BTC 1–2")
        self.assertEqual(sc["eth_text"], "0–0 ETH")
        self.assertEqual(sc["eth_shadow"]["correct"], 5)
        self.assertEqual(sc["btc_shadow"]["correct"], 5)


class Top3ConflictHonestyTests(unittest.TestCase):
    def test_real_gates_win_over_top_conflict_flag(self):
        self.assertEqual(
            classify_wait_reason(
                "WAIT · P(finish) 0.40 < 0.55 — no lock",
                {"top_conflict": True, "top_agree": True},
            ),
            "no_ev",
        )
        self.assertEqual(
            classify_wait_reason("WAIT · EV 1.2¢ < 0 after half-spread — no lock", {"top_conflict": True}),
            "no_ev",
        )
        self.assertEqual(
            classify_wait_reason("WAIT · spread 8.0¢ > 5¢ — no lock", {"top_conflict": True}),
            "spread",
        )
        self.assertEqual(
            classify_wait_reason("WAIT · dead book · YES mid 12¢ outside 20–80¢", {"top_conflict": True}),
            "dead_book",
        )
        self.assertEqual(
            classify_wait_reason("WAIT", {"top_conflict": True, "top_agree": True}),
            "other",
        )
        self.assertEqual(
            classify_wait_reason("WAIT", {"top_conflict": True, "summary": "top-3 conflict"}),
            "top_3_conflict",
        )

    def test_muted_seats_do_not_create_conflict(self):
        muted = _sig("cheap", "DOWN", 80, muted=True, hard_mute=True)
        faded = _sig("panic", "DOWN", 70, faded=True, invert=True)
        live = _sig("candle", "UP", 80)
        self.assertFalse(chair_top_dir_eligible(muted))
        self.assertFalse(chair_top_dir_eligible(faded))
        self.assertTrue(chair_top_dir_eligible(live))


class FarOtmFilterTests(unittest.TestCase):
    def test_live_companions_are_far_otm(self):
        self.assertTrue(far_otm_companion(71799.99, 70000, "btc"))
        self.assertTrue(far_otm_companion(2594.99, 2470, "eth"))
        self.assertFalse(far_otm_companion(70100, 70000, "btc"))
        self.assertFalse(far_otm_companion(2500, 2470, "eth"))
        self.assertIn(
            "far-OTM",
            chair_ticker_blocked(ticker="KXBTCD-26AUG1616-T71799.99", spot=70000, asset="btc") or "",
        )
        self.assertIn(
            "far-OTM",
            chair_ticker_blocked(ticker="KXETHD-26AUG1616-T2594.99", spot=2470, asset="eth") or "",
        )
        self.assertIsNone(chair_ticker_blocked(strike=63000, spot=62950, asset="btc"))

    def test_far_otm_is_wait_shadow_only(self):
        from backend.tests.test_chair_gates import BtcShadowPickTests

        helper = BtcShadowPickTests()
        chair = Leader()
        out = chair.synthesize(
            helper._signals("UP"),
            helper._btc_regime(
                ticker="KXBTCD-26AUG1616-T71799.99",
                floor_strike=71799.99,
                spot_price=70000,
                current_price=70000,
                mins_left=25,
            ),
        )
        self.assertEqual(out["direction"], "WAIT")
        self.assertIn("far-OTM", (out.get("summary") or ""))
        self.assertIsNotNone(out.get("btc_shadow_pick"))
        self.assertFalse(out.get("window_locked"))


class UniqueSettleKeyTests(unittest.TestCase):
    def test_cloned_payloads_are_not_four_seats(self):
        shared = seat_settle_key("exhaust", "KXBTCD-T1", "2026-08-16T16:00:00Z")
        cloned = {
            name: {
                "agent_name": "exhaust",
                "direction": "UP",
                "confidence": 70,
                "settle_key": shared,
            }
            for name in ("liq", "news", "spotlag", "exhaust")
        }
        uniq = unique_agent_votes(cloned)
        self.assertEqual(set(uniq), {"exhaust"})
        four = {
            name: {
                "agent_name": name,
                "direction": "UP",
                "confidence": 70,
                "settle_key": seat_settle_key(name, "KXBTCD-T1", "2026-08-16T16:00:00Z"),
            }
            for name in ("liq", "news", "spotlag", "exhaust")
        }
        self.assertEqual(len(unique_agent_votes(four)), 4)
        self.assertEqual(len({v["settle_key"] for v in four.values()}), 4)

    def test_learn_skips_clones_and_eth_ghosts(self):
        btc = AdaptiveLearner(asset="btc")
        shared = seat_settle_key("exhaust", "T", "C")
        btc.learn_from_settled(
            {
                "liq": {"agent_name": "exhaust", "direction": "UP", "confidence": 70, "settle_key": shared},
                "news": {"agent_name": "exhaust", "direction": "UP", "confidence": 70, "settle_key": shared},
                "spotlag": {"agent_name": "exhaust", "direction": "UP", "confidence": 70, "settle_key": shared},
                "exhaust": {"agent_name": "exhaust", "direction": "UP", "confidence": 70, "settle_key": shared},
            },
            "UP",
        )
        self.assertEqual(btc.correct["exhaust"], 1)
        self.assertEqual(int(btc.correct.get("liq") or 0), 0)
        self.assertEqual(int(btc.correct.get("news") or 0), 0)
        eth = AdaptiveLearner(asset="eth")
        eth.learn_from_settled(
            {
                "news": {"agent_name": "news", "direction": "UP", "confidence": 70},
                "spotlag": {"agent_name": "spotlag", "direction": "UP", "confidence": 70},
                "exhaust": {"agent_name": "exhaust", "direction": "UP", "confidence": 70},
            },
            "UP",
        )
        self.assertEqual(int(eth.correct.get("news") or 0), 0)
        self.assertEqual(int(eth.correct.get("spotlag") or 0), 0)
        self.assertEqual(eth.correct["exhaust"], 1)

    def test_historical_votes_without_key_grade_by_dict_key(self):
        btc = AdaptiveLearner(asset="btc")
        btc.learn_from_settled(
            {
                "liq": {"direction": "UP", "confidence": 70},
                "exhaust": {"direction": "UP", "confidence": 70},
            },
            "UP",
        )
        self.assertEqual(btc.correct["liq"], 1)
        self.assertEqual(btc.correct["exhaust"], 1)

    def test_stamp_is_per_seat(self):
        a = _sig("liq")
        b = _sig("exhaust")
        stamp_signal_settle_keys([a, b], "KXBTCD-T1", "close")
        self.assertEqual(a.settle_key, "liq|KXBTCD-T1|close")
        self.assertEqual(b.settle_key, "exhaust|KXBTCD-T1|close")
        self.assertNotEqual(a.settle_key, b.settle_key)


class CoinGlassQuorumTests(unittest.TestCase):
    def test_seats_out_of_quorum_when_n0(self):
        sigs = [_sig("funding"), _sig("oi_pressure", "DOWN"), _sig("liq"), _sig("candle")]
        dead = {
            "health": {"coinglass": False},
            "coinglass": {"interval": "30m", "funding_history": [], "oi_history": [], "liq_history": []},
        }
        peers = quorum_peer_dirs(sigs, dead)
        self.assertNotIn("funding", peers)
        self.assertNotIn("oi_pressure", peers)
        self.assertNotIn("liq", peers)
        self.assertIn("candle", peers)
        live = {
            "health": {"coinglass": True},
            "coinglass": {
                "interval": "1h",
                "funding_history": [(1, 0.01)],
                "oi_history": [],
                "liq_history": [],
            },
        }
        ready = quorum_peer_dirs(sigs, live)
        self.assertIn("funding", ready)
        self.assertIn("liq", ready)

    def test_coinglass_reason_string_unchanged(self):
        self.assertEqual(PLAN_WALL_REASON, "plan wall: need Startup+ for 30m/1h")
        self.assertIn('PLAN_WALL_REASON = "plan wall: need Startup+ for 30m/1h"', CG_SRC)


class LearningPhaseTests(unittest.TestCase):
    def test_phase_uses_chair_lock_n_not_per_seat_average(self):
        learner = AdaptiveLearner(asset="btc")
        for _ in range(80):
            learner.correct["candle"] += 1
            learner.correct["volume"] += 1
        stale_avg = (sum(learner.correct.values()) + sum(learner.wrong.values())) // max(1, len(learner.weights))
        self.assertGreaterEqual(stale_avg, 4)
        self.assertEqual(learner.learning_phase()["n"], 0)
        self.assertEqual(learner.learning_phase()["phase"], "explore")
        self.assertEqual(learner.snapshot()["learning_phase"]["phase"], "explore")
        self.assertEqual(learner.learning_phase(chair_n=20)["phase"], "calibrate")
        learner.lock_n = 80
        self.assertEqual(learner.learning_phase()["phase"], "exploit")
        self.assertEqual(learner.snapshot()["learning_phase"]["n"], 80)
        self.assertNotIn("cold", str(learner.snapshot()["learning_phase"]))
        self.assertNotIn("learned", str(learner.snapshot()["learning_phase"]))


class EthGhostWeightTests(unittest.TestCase):
    def test_no_leftover_wire_orbit_vel_streak(self):
        eth = AdaptiveLearner(asset="eth")
        eth.load_from_dict(
            {
                "weights": {"news": 0.1, "regime": 0.05, "spotlag": 0.1, "streak": 0.06, "exhaust": 0.02},
                "correct": {"news": 117, "regime": 40, "spotlag": 117, "streak": 20, "exhaust": 2},
                "wrong": {"news": 113, "spotlag": 113, "exhaust": 1},
            }
        )
        for ghost in ("news", "regime", "spotlag", "streak"):
            self.assertNotIn(ghost, eth.weights)
            self.assertNotIn(ghost, eth.correct)
            self.assertNotIn(ghost, eth.wrong)
        self.assertIn("exhaust", eth.weights)


class SilenceGateTests(unittest.TestCase):
    def test_vel_silent_until_lag_samples(self):
        vel = SpotLagSpecialist()
        sig = asyncio.run(
            vel.get_signal(
                {
                    "current_price": 70000,
                    "mins_left": 8,
                    "wm": {"phase": "mid", "entry_dir": "UP"},
                }
            )
        )
        self.assertEqual(sig.direction, "WAIT")
        self.assertIn("lag_samples", sig.reasoning)
        vel._lag_log["UNKNOWN_MID"] = [{"lead": 12.0, "k_delta": 2.0, "hit": 1, "t": 1.0}]
        armed = asyncio.run(
            vel.get_signal(
                {
                    "current_price": 70000,
                    "mins_left": 8,
                    "wm": {"phase": "mid", "entry_dir": "UP"},
                    "regime_key": "UNKNOWN_MID",
                }
            )
        )
        self.assertEqual(armed.direction, "UP")

    def test_whale_silent_until_print_count(self):
        whale = WhaleSpecialist()
        proxy = asyncio.run(
            whale.get_signal(
                {
                    "buy_volume": 400,
                    "sell_volume": 10,
                    "mins_left": 40,
                    "wm": {"phase": "entry"},
                }
            )
        )
        self.assertEqual(proxy.direction, "WAIT")
        self.assertEqual(proxy.features.get("print_count"), 0.0)
        self.assertIn("print_count", proxy.reasoning)
        live = asyncio.run(
            whale.get_signal(
                {
                    "whale_trades": [
                        {"size": 12, "side": "buy"},
                        {"size": 9, "side": "buy"},
                    ],
                    "mins_left": 40,
                    "wm": {"phase": "entry"},
                }
            )
        )
        self.assertGreater(live.features.get("print_count") or 0, 0)
        self.assertEqual(live.direction, "UP")


class WireNotesTests(unittest.TestCase):
    def test_nine_audit_notes_are_newest(self):
        ids = [
            "2026-08-16-hard-mute-wire",
            "2026-08-16-chair-scorecard",
            "2026-08-16-top3-honesty",
            "2026-08-16-far-otm-chair",
            "2026-08-16-unique-settle-keys",
            "2026-08-16-coinglass-quorum-out",
            "2026-08-16-one-learning-phase",
            "2026-08-16-eth-no-ghosts",
            "2026-08-16-vel-whale-silent",
        ]
        for wid in ids:
            self.assertIn(wid, WIRE_JS)
        self.assertLess(WIRE_JS.find(ids[0]), WIRE_JS.find(ids[-1]))
        self.assertLess(WIRE_JS.find(ids[0]), WIRE_JS.find("2026-08-16-gold-floor-mark"))
        self.assertNotIn("ZT ·", WIRE_JS.split(ids[0], 1)[1][:400])


if __name__ == "__main__":
    unittest.main()
