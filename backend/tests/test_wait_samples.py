"""WAIT samples for closed hours with no lock + #focusFront gold tab."""
from __future__ import annotations

import os
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from backend.agents.chair_gates import (
    classify_wait_reason,
    decide_open_lock_grade,
    decide_open_wait_grade,
    dead_book_reason,
    early_lock_blocked,
    official_y_finish,
    playable_yes_mid,
)
from backend.learning.adaptive import AdaptiveLearner
from backend.services import desk_front
from backend.tests.test_desk_front import NOW, _fetch_factory, _m, _nws_high_only

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "frontend" / "static" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "static" / "roundtable.js").read_text(encoding="utf-8")
CSS = (ROOT / "frontend" / "static" / "style.css").read_text(encoding="utf-8")
DB = (ROOT / "backend" / "storage" / "db.py").read_text(encoding="utf-8")
LEADER = (ROOT / "backend" / "agents" / "leader.py").read_text(encoding="utf-8")
FOLLOWER_DIR = ROOT / "backend" / "services"


class WaitReasonAndGradeTests(unittest.TestCase):
    def test_hypothesis_store_skipped_wait_locks(self):
        """Closer/store previously skipped rows without a lock — WAIT never stored."""
        self.assertIn("def _grade_side", DB)
        self.assertIn('if direction in ("UP", "UP_HOLD")', DB)
        self.assertIn("def record_wait_sample", DB)
        self.assertIn("WAIT samples are stored", DB)
        self.assertIn("decide_open_wait_grade", DB)

    def test_classify_wait_reason_listed_whys(self):
        self.assertEqual(classify_wait_reason("WAIT · fresh quote required (40s old)"), "stale_quote")
        self.assertEqual(classify_wait_reason("WAIT · first 10m of the hour — no lock"), "first_10m")
        self.assertEqual(classify_wait_reason("WAIT · dead book · YES mid 12¢ outside 20–80¢"), "dead_book")
        self.assertEqual(classify_wait_reason("WAIT · unknown book — no lock"), "unknown_book")
        self.assertEqual(classify_wait_reason("WAIT · thin book (need ≥5 size) — no lock"), "no_depth")
        self.assertEqual(classify_wait_reason("WAIT · odds 18¢ outside 20–80¢"), "odds_outside_20_80")
        self.assertEqual(classify_wait_reason("WAIT · odds 5¢ outside 10–90¢"), "odds_outside_20_80")
        self.assertEqual(
            classify_wait_reason("WAIT", {"top_conflict": True, "summary": "top-3 conflict"}),
            "top_3_conflict",
        )
        self.assertEqual(classify_wait_reason("Insufficient confluence – WAIT"), "low_confluence")
        self.assertEqual(classify_wait_reason("need stronger confluence"), "low_confluence")

    def test_wait_grade_official_only_never_invents(self):
        after = datetime(2026, 8, 14, 20, 0, tzinfo=timezone.utc)
        before = datetime(2026, 8, 14, 18, 0, tzinfo=timezone.utc)
        live = {
            "ticker": "KXBTCD-26AUG1415-T62999.99",
            "status": "finalized",
            "result": "no",
        }
        grade = decide_open_wait_grade(
            ticker="KXBTCD-26AUG1415-T62999.99",
            close_time="2026-08-14T19:00:00+00:00",
            kalshi_result=live,
            now=after,
        )
        self.assertIsNotNone(grade)
        self.assertEqual(grade["y_finish"], "DOWN")
        self.assertIsNone(grade["correct"])
        self.assertEqual(grade["settle_reason"], "wait_finish")
        self.assertEqual(grade["paper_pnl"], 0.0)
        self.assertIsNone(
            decide_open_wait_grade(
                ticker="KXBTCD-26AUG1415-T62999.99",
                close_time="2026-08-14T19:00:00+00:00",
                kalshi_result=None,
                now=before,
            )
        )
        self.assertIsNone(
            decide_open_wait_grade(
                ticker="KXBTCD-26AUG9999-T1",
                close_time="2026-08-14T19:00:00+00:00",
                kalshi_result={"status": "active"},
                now=after,
            )
        )
        self.assertIsNone(official_y_finish({"status": "active"}))

    def test_lock_gates_not_loosened(self):
        self.assertTrue(early_lock_blocked(55.0, 60.0, 10.0))
        self.assertFalse(early_lock_blocked(40.0, 60.0, 10.0))
        self.assertIn("EARLY_NO_LOCK_MINS", LEADER)
        self.assertIn("dead_book_reason", LEADER)
        self.assertTrue(playable_yes_mid(50))
        self.assertTrue(playable_yes_mid(12))
        self.assertTrue(playable_yes_mid(88))
        self.assertFalse(playable_yes_mid(9))
        self.assertIn("outside 10–90", dead_book_reason(None, "UP", 5) or "")
        lock = decide_open_lock_grade(
            ticker="KXBTCD-26AUG1415-T62999.99",
            direction="WAIT",
            kalshi_result={"status": "finalized", "result": "yes"},
            now=datetime(2026, 8, 14, 20, 0, tzinfo=timezone.utc),
        )
        self.assertIsNone(lock)


class WaitLearnerTests(unittest.TestCase):
    def test_learn_from_wait_updates_wait_rate_and_anti_pairs(self):
        learner = AdaptiveLearner(asset="btc")
        votes = {
            "candle": {"direction": "UP", "confidence": 70},
            "momentum": {"direction": "DOWN", "confidence": 65},
            "volume": {"direction": "UP", "confidence": 60},
        }
        out = learner.learn_from_wait(
            agent_votes=votes,
            outcome=None,
            wait_reason="dead_book",
            would_lock_if_strict=True,
        )
        self.assertEqual(learner.wait_n, 1)
        self.assertEqual(learner.wait_reasons["dead_book"], 1)
        self.assertEqual(learner.lock_n, 0)
        self.assertEqual(out["wait_rate"], 1.0)
        graded = learner.learn_from_wait(
            agent_votes=votes,
            outcome="UP",
            wait_reason="dead_book",
            would_lock_if_strict=True,
            count_wait=False,
        )
        self.assertEqual(learner.wait_n, 1)
        self.assertGreater(learner.updates, 0)
        self.assertIn("strict band would have", " ".join(graded.get("notes") or []))
        snap = learner.snapshot()
        self.assertEqual(snap["wait_n"], 1)
        self.assertIn("dead_book", snap["when_not_to_lock"])
        payload = learner.export_dict()
        self.assertEqual(payload["wait_n"], 1)
        self.assertIn("when_not_to_lock", payload)

    def test_rebuild_includes_wait_rows(self):
        import asyncio

        learner = AdaptiveLearner(asset="btc")

        class _Store:
            async def recent_settled_calls(self, limit=120, asset=None):
                return [
                    {
                        "id": 9,
                        "direction": "WAIT",
                        "settle_reason": "wait_finish",
                        "y_finish": "DOWN",
                        "wait_reason": "first_10m",
                        "would_lock_if_strict": False,
                        "agent_votes": {
                            "candle": {"direction": "DOWN", "confidence": 80},
                            "momentum": {"direction": "DOWN", "confidence": 70},
                        },
                    }
                ]

        rebuilt = asyncio.run(learner.rebuild_from_store(_Store()))
        self.assertEqual(rebuilt, 1)
        self.assertEqual(learner.wait_n, 1)
        self.assertEqual(learner.wait_reasons["first_10m"], 1)


class WaitStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_record_wait_sample_writes_and_paper_pnl_zero(self):
        from backend.config import settings
        from backend.storage.db import PerformanceStore, WindowCall
        from sqlalchemy import select

        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        url = f"sqlite+aiosqlite:///{path}"
        try:
            with patch.object(settings, "DATABASE_URL", url):
                store = PerformanceStore()
                await store.init()
                created = await store.record_wait_sample(
                    ticker="KXBTCD-26AUG1514-T100000.00",
                    close_time="2026-08-15T18:00:00+00:00",
                    wait_reason="dead_book",
                    seat_split={"UP": 3, "DOWN": 2, "WAIT": 4, "total": 9},
                    book_depth={"yes_depth": 0, "no_depth": 1},
                    would_lock_if_strict=True,
                    asset="btc",
                    confidence=70,
                )
                self.assertTrue(created)
                again = await store.record_wait_sample(
                    ticker="KXBTCD-26AUG1514-T100000.00",
                    close_time="2026-08-15T18:00:00+00:00",
                    wait_reason="dead_book",
                    asset="btc",
                )
                self.assertFalse(again)
                n = await store.settle_expired_calls(
                    kalshi_results={
                        "KXBTCD-26AUG1514-T100000.00": {
                            "ticker": "KXBTCD-26AUG1514-T100000.00",
                            "status": "finalized",
                            "result": "yes",
                        }
                    },
                )
                self.assertEqual(n, 1)
                async with store.Session() as session:
                    row = (
                        await session.execute(select(WindowCall).where(WindowCall.direction == "WAIT"))
                    ).scalar_one()
                self.assertEqual(row.wait_reason, "dead_book")
                self.assertEqual(row.y_finish, "UP")
                self.assertEqual(row.actual_outcome, "WAIT")
                self.assertIsNone(row.correct)
                self.assertEqual(row.paper_pnl, 0.0)
                self.assertEqual(row.paper_stake, 0.0)
                self.assertEqual(row.settle_reason, "wait_finish")
                acc = await store.get_accuracy(asset="btc")
                self.assertEqual(acc["wait_n"], 1)
                self.assertEqual(acc["total"], 0)
                self.assertEqual(acc["wait_rate"], 1.0)
                self.assertNotIn(row.direction, ("UP", "DOWN"))
        finally:
            try:
                os.remove(path)
            except OSError:
                pass

    async def test_wait_does_not_invent_finish(self):
        from backend.config import settings
        from backend.storage.db import PerformanceStore, WindowCall
        from sqlalchemy import select

        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        url = f"sqlite+aiosqlite:///{path}"
        try:
            with patch.object(settings, "DATABASE_URL", url):
                store = PerformanceStore()
                await store.init()
                await store.record_wait_sample(
                    ticker="KXETHD-26AUG1514-T3000.00",
                    close_time=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
                    wait_reason="first_10m",
                    asset="eth",
                )
                n = await store.settle_expired_calls(kalshi_results={})
                self.assertEqual(n, 0)
                async with store.Session() as session:
                    row = (
                        await session.execute(select(WindowCall))
                    ).scalar_one()
                self.assertIsNone(row.y_finish)
                self.assertIsNone(row.actual_outcome)
                self.assertEqual(row.paper_pnl, 0.0)
        finally:
            try:
                os.remove(path)
            except OSError:
                pass


class FrontWaitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        desk_front.reset_for_tests(Path(self.tmp.name))

    def test_front_wait_sample_dallas_only_pnl_zero(self):
        day = date(2026, 8, 15)
        row = desk_front.record_wait_sample(
            day=day,
            ticker="KXHIGHTDAL-26AUG15-B103104",
            skip="Don’t play · empty book",
            votes=[{"id": "GLASS", "dir": "WAIT"}, {"id": "FROST", "dir": "SKIP"}],
            would_lock_if_strict=False,
            strike_type="between",
            floor_strike=103,
            cap_strike=104,
        )
        self.assertIsNotNone(row)
        self.assertEqual(row["side"], "WAIT")
        self.assertEqual(row["pnl"], 0.0)
        self.assertEqual(row["city"], "DAL")
        self.assertEqual(row["station"], "KDFW")
        self.assertEqual(row["wait_reason"], "empty_book")
        self.assertTrue(desk_front.apply_cli_settle(row, 103.0))
        self.assertEqual(row["result"], "WAIT")
        self.assertEqual(row["pnl"], 0.0)
        self.assertEqual(row["settle_reason"], "wait_cli")
        self.assertIn(row["y_finish"], ("YES", "NO"))
        acc = desk_front.chair_accuracy()
        self.assertEqual(acc["wait_n"], 1)
        self.assertEqual(acc["total"], 0)
        self.assertNotIn("KXHIGHNY", str(row))
        self.assertNotIn("KXHIGHCHI", str(row))

    def test_front_wait_not_written_over_lock(self):
        day = date(2026, 8, 15)
        desk_front._fills.append({
            "day": day.isoformat(),
            "side": "YES",
            "result": "OPEN",
            "city": "DAL",
        })
        self.assertIsNone(desk_front.record_wait_sample(day=day, skip="thin"))

    def test_dont_play_is_wait_not_down_lock(self):
        skip = desk_front.build_chair({"dont_play": True, "skip": "Don’t play · sample too thin"})
        self.assertEqual(skip["eye"], "WAIT")
        self.assertTrue(skip["mark"].endswith("raijin-chair.png"))

    def test_would_lock_if_strict_can_be_true_when_gate_is_only_reason(self):
        best = {
            "p_forecast": 0.70,
            "yes_ask": 48,
            "dont_play": True,
            "skip": "Don’t play · sample too thin",
            "confidence": 18,
            "strike_type": "between",
            "floor_strike": 103,
            "cap_strike": 104,
            "climo": 96,
        }
        self.assertTrue(desk_front.front_would_lock_if_strict(best, 50))
        self.assertFalse(desk_front.front_would_lock_if_strict(None, 50))
        weak = dict(best, p_forecast=0.20, yes_ask=80)
        self.assertFalse(desk_front.front_would_lock_if_strict(weak, 50))


class FrontWaitBuildBoardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        desk_front.reset_for_tests(Path(self.tmp.name))

    async def test_build_board_writes_wait_on_dont_play_best(self):
        """Skip/thin days still write a WAIT row. pick_best returns dont_play."""
        thin = _m("KXHIGHTDAL-26AUG15-B103104", volume="50")
        board = await desk_front.build_board(
            fetch=_fetch_factory({"rows": [thin]}),
            nws=_nws_high_only,
            now=NOW,
            wx_obs={"text": "Clear", "raw": "CLR", "temp_f": 101},
        )
        best = next((b for b in board["brackets"] if b.get("best")), None)
        self.assertIsNotNone(best)
        self.assertTrue(best.get("dont_play"))
        self.assertEqual(board["chair"]["eye"], "WAIT")
        self.assertTrue(board["chair"]["mark"].endswith("raijin-chair.png"))
        waits = [
            r for r in desk_front._load_fills()
            if str(r.get("side") or "").upper() == "WAIT" and not r.get("superseded")
        ]
        self.assertEqual(len(waits), 1, waits)
        row = waits[0]
        self.assertEqual(row["city"], "DAL")
        self.assertEqual(row["station"], "KDFW")
        self.assertEqual(row["pnl"], 0.0)
        self.assertEqual(row["paper"], True)
        self.assertIn(row.get("wait_reason"), ("no_depth", "dead_book", "other"))
        self.assertTrue(row.get("would_lock_if_strict"), row)
        self.assertEqual(board["accuracy"]["wait_n"], 1)
        self.assertNotIn("KXHIGHNY", row.get("ticker") or "")
        self.assertNotIn("KXHIGHCHI", row.get("ticker") or "")


class FocusFrontWiringTests(unittest.TestCase):
    def test_gold_focus_front_tab(self):
        self.assertIn('id="focusFront"', HTML)
        self.assertIn('class="focus-tab"', HTML)
        self.assertIn('data-focus="front"', HTML)
        self.assertIn(">DWF</button>", HTML)
        self.assertIn("Focus Dallas Weather Forecast / Raijin", HTML)
        self.assertNotIn(">RAIJIN</button>", HTML)
        self.assertNotIn(">DFW</button>", HTML)
        self.assertIn('id="focusAts"', HTML)
        self.assertIn(">ATS</button>", HTML)
        self.assertIn('id="focusBtc"', HTML)
        self.assertIn('id="focusEth"', HTML)
        row = HTML.split('id="modeTabs"', 1)[1].split('id="tabFloor"', 1)[0]
        self.assertIn("focusBtc", row)
        self.assertIn("focusEth", row)
        self.assertIn("focusFront", row)
        self.assertIn("focusAts", row)
        self.assertIn("focusOra", row)
        self.assertIn('body[data-focus-table="front"]', CSS)
        self.assertIn("#focusFront.focus-active", CSS)

    def test_focus_front_lands_on_table_not_weather_page(self):
        self.assertIn("function isFrontTable", JS)
        self.assertIn("function frontTableState", JS)
        self.assertIn('bind(focusFront, "front")', JS)
        self.assertIn('focusTable = "front"', JS)
        self.assertIn('if (mode === "front") setMode("art")', JS)
        self.assertIn("return raijinPortrait", JS.split("function chairPortraitOf", 1)[1][:400])
        self.assertIn('chairPortraitOf(which, dir)', JS)
        self.assertIn("DFW · Raijin", JS)
        self.assertIn("DFW · RAIJIN", JS)
        self.assertIn("waiting on Satoshi / Vitalik / Raijin / Ares", JS)

    def test_floor_raijin_focuses_table(self):
        wire = JS.split("function wireFloorChairClicks", 1)[1].split("wireFloorChairClicks();", 1)[0]
        self.assertIn('setFocusTable("front")', wire)
        self.assertNotIn('setMode("front")', wire)
        chip = JS.split('id="floorRaijin"', 1)
        self.assertTrue(JS.find('getElementById("floorRaijin")') > 0)
        btn = JS.split('const floorRaijinBtn', 1)[1].split("window.setMode", 1)[0]
        self.assertIn('setFocusTable("front")', btn)
        self.assertNotIn('setMode("front")', btn)

    def test_spin_still_untouched_and_no_zt_wordmark(self):
        self.assertIn('btn.textContent = spinning ? "SPIN" : "STILL"', JS)
        self.assertNotIn("ZT", HTML.split('id="focusFront"', 1)[1].split("</button>", 1)[0])
        self.assertNotIn("Zero", "DFW · Raijin")
        follower = list(FOLLOWER_DIR.glob("follower_*.py"))
        self.assertTrue(follower)


if __name__ == "__main__":
    unittest.main()
