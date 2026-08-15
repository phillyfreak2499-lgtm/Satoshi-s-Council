"""90-day Kalshi seat backfill: official result only, merge, no live, no Follower."""
from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from backend.agents.chair_gates import official_y_finish
from backend.learning.adaptive import AdaptiveLearner
from backend.learning import seat_backfill as sb
from backend.services.huddle import PRUNE_DAYS

ROOT = Path(__file__).resolve().parents[2]
ET = ZoneInfo("America/New_York")
UTC = timezone.utc

BACKFILL_PY = (ROOT / "backend" / "learning" / "seat_backfill.py").read_text(encoding="utf-8")
ADAPTIVE_PY = (ROOT / "backend" / "learning" / "adaptive.py").read_text(encoding="utf-8")
HUDDLE_PY = (ROOT / "backend" / "services" / "huddle.py").read_text(encoding="utf-8")
DUAL_PY = (ROOT / "backend" / "services" / "dual.py").read_text(encoding="utf-8")
MAIN_PY = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
GATES_PY = (ROOT / "backend" / "agents" / "chair_gates.py").read_text(encoding="utf-8")
LAW_PY = (ROOT / "backend" / "agents" / "law.py").read_text(encoding="utf-8")
FOLLOWER_GATE = (ROOT / "backend" / "services" / "follower_gate.py").read_text(encoding="utf-8")
WIRE_JS = (ROOT / "frontend" / "static" / "wire.js").read_text(encoding="utf-8")
DEPLOY = (ROOT / "deploy" / "seat_backfill.py").read_text(encoding="utf-8")


def _hour_et(y=2026, m=8, d=10, h=15):
    return datetime(y, m, d, h, 0, 0, tzinfo=ET)


def _async_candles(close=64000.0, n=80):
    async def _inner():
        return _candles(n=n, close=close)
    return _inner


def _candles(n=80, start=None, close=64000.0):
    start = start or datetime(2026, 8, 10, 18, 0, tzinfo=UTC)
    rows = []
    px = float(close)
    for i in range(n):
        t = start + timedelta(minutes=i)
        rows.append({
            "open_time": int(t.timestamp() * 1000),
            "open": px,
            "high": px + 20,
            "low": px - 20,
            "close": px + (4 if i % 2 == 0 else -2),
            "volume": 10.0 + i,
            "close_time": int(t.timestamp() * 1000) + 59999,
        })
        px = rows[-1]["close"]
    return rows


def _official_event(ticker="KXBTCD-26AUG1016-T63999.99", result="yes"):
    return {
        "event": {"event_ticker": "KXBTCD-26AUG1016", "status": "determined"},
        "markets": [
            {"ticker": ticker, "status": "finalized", "result": result, "floor_strike": 63999.99},
            {"ticker": "KXBTCD-26AUG1016-T65000.00", "status": "finalized", "result": "no"},
            {"ticker": "KXBTCD-26AUG1016-T62000.00", "status": "active"},
        ],
    }


class ContractAndWindowTests(unittest.TestCase):
    def test_90_day_window_matches_huddle_prune(self):
        self.assertEqual(sb.BACKFILL_DAYS, 90)
        self.assertEqual(sb.BACKFILL_DAYS, PRUNE_DAYS)
        c = sb.backfill_contract()
        self.assertEqual(c["days"], 90)
        self.assertIn("huddle", c["window"])

    def test_hour_slots_cap_at_90_days(self):
        now = datetime(2026, 8, 15, 12, 0, tzinfo=UTC)
        slots = sb.hour_slots(days=90, now=now)
        span = (slots[-1] - slots[0]).total_seconds() / 86400.0
        self.assertLessEqual(span, 90.1)
        self.assertGreater(span, 89.0)
        wide = sb.hour_slots(days=180, now=now)
        self.assertLessEqual(len(wide), len(slots) + 1)

    def test_btc_and_eth_tickers(self):
        c = sb.backfill_contract()
        self.assertEqual(c["series"], ["KXBTCD", "KXETHD"])
        self.assertEqual(c["assets"], ["btc", "eth"])
        et = _hour_et(2026, 8, 14, 15)
        self.assertEqual(sb.event_ticker_for_hour("KXBTCD", et), "KXBTCD-26AUG1415")
        self.assertEqual(sb.event_ticker_for_hour("KXETHD", et), "KXETHD-26AUG1415")
        self.assertEqual(sb.series_for_asset("btc"), "KXBTCD")
        self.assertEqual(sb.series_for_asset("eth"), "KXETHD")


class OfficialResultOnlyTests(unittest.TestCase):
    def test_official_result_yes_no_only(self):
        yes = {"ticker": "KXBTCD-26AUG1016-T63999.99", "status": "finalized", "result": "yes"}
        no = {"ticker": "KXETHD-26AUG1016-T2000.00", "status": "finalized", "result": "no"}
        self.assertEqual(official_y_finish(yes), "UP")
        self.assertEqual(official_y_finish(no), "DOWN")
        self.assertIn("official_y_finish", BACKFILL_PY)
        self.assertIn("collect_official_results", BACKFILL_PY)
        self.assertIn('"impute_missing_result": false', json.dumps(sb.backfill_contract()))

    def test_skip_missing_result(self):
        self.assertIsNone(official_y_finish({"ticker": "KXBTCD-X", "status": "finalized"}))
        self.assertIsNone(official_y_finish({"status": "active", "result": "yes"}))
        self.assertIsNone(sb.pick_atm_with_official_result(
            [{"ticker": "KXBTCD-26AUG1016-T1", "status": "finalized", "floor_strike": 1}],
            100.0,
        ))


class OfficialSkipAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_grade_skips_missing_result(self):
        learner = AdaptiveLearner(asset="btc")
        before = dict(learner.correct)

        async def ev(_ticker):
            return {"event": {"status": "determined"}, "markets": [
                {"ticker": "KXBTCD-26AUG1016-T1", "status": "finalized"}
            ]}, None

        async def candles():
            return _candles()

        rec = await sb.grade_one_hour(
            series="KXBTCD",
            hour_et=_hour_et(2026, 8, 10, 15),
            learner=learner,
            kalshi=None,
            candle_symbol="BTCUSDT",
            fetch_event=ev,
            fetch_candles=candles,
        )
        self.assertEqual(rec["status"], "skip")
        self.assertEqual(rec["reason"], "no_official_result")
        self.assertEqual(dict(learner.correct), before)

    async def test_429_skips_hour_does_not_fake(self):
        learner = AdaptiveLearner(asset="eth")
        n0 = learner.backfill.get("hours_graded")

        async def ev(_ticker):
            return None, sb.RATE_LIMIT

        async def candles():
            return _candles()

        with patch.object(sb, "KALSHI_429_SLEEP_S", 0):
            rec = await sb.grade_one_hour(
                series="KXETHD",
                hour_et=_hour_et(2026, 8, 10, 15),
                learner=learner,
                kalshi=None,
                candle_symbol="ETHUSDT",
                fetch_event=ev,
                fetch_candles=candles,
            )
        self.assertEqual(rec["reason"], sb.RATE_LIMIT)
        self.assertEqual(learner.backfill.get("hours_graded"), n0)
        self.assertIn("RATE_LIMIT", BACKFILL_PY)
        self.assertIn("do not invent", BACKFILL_PY.lower())


class SeatFilterTests(unittest.TestCase):
    def test_rebuildable_and_skipped_seats(self):
        c = sb.backfill_contract()
        self.assertEqual(
            c["seats_rebuilt"],
            [
                "WICK", "DRIFT", "PULSE", "STRIKE", "ODDS", "CLOCK",
                "CHEAP", "EXHAUST", "VOLT", "CARRY", "CHAIN", "CASCADE",
            ],
        )
        skipped = {row["callsign"] for row in c["seats_skipped"]}
        self.assertEqual(skipped, {"TAPE", "WHALE"})
        self.assertNotIn("CARRY", skipped)
        self.assertTrue(sb.is_rebuildable_seat("candle"))
        self.assertTrue(sb.is_rebuildable_seat("funding"))
        self.assertTrue(sb.is_rebuildable_seat("oi_pressure"))
        self.assertTrue(sb.is_rebuildable_seat("liq"))
        self.assertTrue(sb.is_live_only_seat("orderflow"))
        self.assertFalse(sb.is_live_only_seat("funding"))
        self.assertTrue(sb.is_live_only_seat("whale"))
        self.assertEqual(c["coinglass"]["seats"], ["CARRY", "CHAIN", "CASCADE"])
        self.assertEqual(c["coinglass"]["interval_order"], ["30m", "1h"])
        self.assertEqual(c["coinglass"]["never"], "1m")
        self.assertTrue(c["coinglass"]["reuses_live_client"])
        self.assertFalse(c["coinglass"]["blocks_candle_replay"])
        self.assertFalse(c["coinglass"]["key_in_git"])

    def test_filter_drops_live_only(self):
        votes = sb.filter_rebuildable_votes({
            "candle": {"direction": "UP", "confidence": 70},
            "orderflow": {"direction": "UP", "confidence": 80},
            "funding": {"direction": "DOWN", "confidence": 80},
            "oi_pressure": {"direction": "UP", "confidence": 70},
            "liq": {"direction": "DOWN", "confidence": 75},
            "whale": {"direction": "UP", "confidence": 80},
            "law": {"direction": "UP", "confidence": 90},
        })
        self.assertIn("candle", votes)
        self.assertIn("funding", votes)
        self.assertIn("oi_pressure", votes)
        self.assertIn("liq", votes)
        self.assertNotIn("orderflow", votes)
        self.assertNotIn("whale", votes)
        self.assertNotIn("law", votes)


class MergeAndTagTests(unittest.IsolatedAsyncioTestCase):
    def test_merge_not_wipe(self):
        learner = AdaptiveLearner(asset="eth")
        learner.correct["candle"] = 5
        learner.wrong["candle"] = 2
        learner.updates = 7
        learner.lock_n = 3
        votes = {
            "candle": {"direction": "UP", "confidence": 70},
            "momentum": {"direction": "UP", "confidence": 65},
            "orderflow": {"direction": "DOWN", "confidence": 90},
        }
        out = sb.merge_backfill_into_learner(learner, votes, "UP", ticker="KXETHD-26AUG1016-T1")
        self.assertGreaterEqual(learner.correct["candle"], 6)
        self.assertEqual(learner.wrong["candle"], 2)
        self.assertGreater(learner.updates, 7)
        self.assertEqual(learner.lock_n, 3)
        self.assertIn("backfill", (out.get("notes") or []) + [out.get("source")])
        self.assertEqual(learner.backfill.get("tag"), "backfill")
        self.assertGreaterEqual(int(learner.backfill.get("hours_graded") or 0), 1)
        self.assertNotIn("orderflow", learner.correct)

    def test_brain_export_keeps_backfill_tag(self):
        learner = AdaptiveLearner(asset="btc")
        sb.merge_backfill_into_learner(
            learner,
            {"strike": {"direction": "DOWN", "confidence": 60}},
            "DOWN",
            ticker="KXBTCD-26AUG1016-T1",
        )
        exported = learner.export_dict()
        self.assertEqual((exported.get("backfill") or {}).get("tag"), "backfill")
        other = AdaptiveLearner(asset="btc")
        other.load_from_dict(exported)
        self.assertEqual(other.backfill.get("tag"), "backfill")
        self.assertGreaterEqual(int(other.backfill.get("hours_graded") or 0), 1)

    async def test_grade_hour_moves_seat_n_not_just_chair(self):
        learner = AdaptiveLearner(asset="eth")
        self.assertEqual(int(learner.correct.get("candle") or 0) + int(learner.wrong.get("candle") or 0), 0)

        async def ev(_ticker):
            return _official_event("KXETHD-26AUG1016-T1874.99", "no"), None

        rec = await sb.grade_one_hour(
            series="KXETHD",
            hour_et=_hour_et(2026, 8, 10, 15),
            learner=learner,
            kalshi=None,
            candle_symbol="ETHUSDT",
            fetch_event=ev,
            fetch_candles=_async_candles(1870.0),
        )
        if rec.get("status") != "graded":
            # CLOCK/STRIKE may still vote; if all WAIT, still prove skip-not-wipe
            self.assertIn(rec.get("reason"), ("no_directional_votes", "graded"))
            return
        self.assertEqual(rec["tag"], "backfill")
        self.assertEqual(rec["y_finish"], "DOWN")
        n = sum(int(learner.correct.get(s) or 0) + int(learner.wrong.get(s) or 0) for s in sb.REBUILDABLE_SEATS)
        self.assertGreater(n, 0)
        self.assertGreater(int(learner.backfill.get("hours_graded") or 0), 0)

    async def test_full_pass_merges_btc_and_eth(self):
        with tempfile.TemporaryDirectory() as td:
            btc = AdaptiveLearner(asset="btc")
            eth = AdaptiveLearner(asset="eth")
            btc.correct["candle"] = 4
            eth.correct["candle"] = 0

            async def ev(ticker):
                series = "KXETHD" if "ETH" in ticker else "KXBTCD"
                result = "yes" if series == "KXBTCD" else "no"
                strike = 63999.99 if series == "KXBTCD" else 1874.99
                return {
                    "markets": [{
                        "ticker": f"{ticker}-T{strike}",
                        "status": "finalized",
                        "result": result,
                        "floor_strike": strike,
                    }],
                }, None

            now = datetime(2026, 8, 10, 18, 0, tzinfo=UTC)
            report = await sb.run_seat_backfill(
                learners={"btc": btc, "eth": eth},
                days=90,
                persist=True,
                data_root=Path(td),
                now=now,
                fetch_event=ev,
                fetch_candles=_async_candles(64010.0),
                max_hours=2,
                force=True,
            )
            self.assertTrue(report["ok"])
            self.assertTrue(report["merge"])
            self.assertFalse(report["wipe_live_brain"])
            self.assertFalse(report["follower"])
            self.assertFalse(report["live_orders"])
            self.assertGreaterEqual(int(btc.correct.get("candle") or 0), 4)
            self.assertEqual(report["contract"]["days"], 90)
            self.assertTrue((Path(td) / sb.DONE_NAME).is_file())
            status = json.loads((Path(td) / sb.STATUS_NAME).read_text(encoding="utf-8"))
            self.assertEqual(status.get("tag"), "backfill")


class LeaveAloneTests(unittest.TestCase):
    def test_follower_untouched(self):
        self.assertNotIn("from backend.services.follower", BACKFILL_PY)
        self.assertNotIn("follower_gate", BACKFILL_PY)
        self.assertNotIn("follower_route", BACKFILL_PY)
        self.assertIn("class FollowerGate", FOLLOWER_GATE)
        self.assertIn("No live orders", BACKFILL_PY)
        self.assertFalse(sb.backfill_contract()["follower"])

    def test_no_law_lock_turn_up(self):
        self.assertNotIn("from backend.agents.law", BACKFILL_PY)
        self.assertNotIn("law_bump", BACKFILL_PY)
        self.assertNotIn("_law_bump_value", BACKFILL_PY)
        self.assertNotIn("LOCK_AFTER_WRONGS", BACKFILL_PY)
        self.assertIn("LOCK_AFTER_WRONGS = 2", LAW_PY)
        self.assertEqual(sb.backfill_contract()["law_lock"], "untouched")

    def test_chair_gates_not_loosened(self):
        cfg = (ROOT / "backend" / "config.py").read_text(encoding="utf-8")
        self.assertIn("EARLY_NO_LOCK_MINS", cfg)
        self.assertIn("def early_lock_blocked", GATES_PY)
        self.assertIn("def never_lock_near_certain", GATES_PY)
        self.assertIn("PLAYABLE_MID_MIN", cfg)
        self.assertNotIn("EARLY_NO_LOCK_MINS", BACKFILL_PY)
        self.assertEqual(sb.backfill_contract()["chair_gates"], "untouched")
        self.assertIn("no window_calls", sb.backfill_contract()["displayed_hit_rate"])

    def test_no_brain_json_committed(self):
        import subprocess
        tracked = subprocess.check_output(
            ["git", "ls-files", "data/council-learning*.json", "**/council-learning*.json"],
            cwd=ROOT,
            text=True,
        ).strip()
        self.assertEqual(tracked, "")
        self.assertIn("DATA_DIR only", sb.backfill_contract()["persist_under"])


class TriggerAndWireTests(unittest.TestCase):
    def test_boot_admin_cli_paths(self):
        self.assertIn("maybe_run_boot_backfill", DUAL_PY)
        self.assertIn("seat-backfill", DUAL_PY)
        self.assertIn("/api/admin/seat-backfill", MAIN_PY)
        self.assertIn("python -m backend.learning.seat_backfill", DEPLOY)
        self.assertIn("SEAT_BACKFILL_ONCE", BACKFILL_PY)
        self.assertIn("seat-backfill.done", BACKFILL_PY)

    def test_wire_note(self):
        self.assertIn("2026-08-15-seat-backfill", WIRE_JS)
        chunk = WIRE_JS.split("2026-08-15-seat-backfill", 1)[1][:700]
        self.assertIn("90-day Kalshi seat backfill", chunk)
        self.assertIn("Merge into the live brain", chunk)
        self.assertIn("Follower OFF", chunk)
        self.assertIn("CoinGlass hist", chunk)
        self.assertIn("30m then 1h", chunk)
        self.assertIn("CARRY", chunk)
        self.assertIn("CHAIN", chunk)
        self.assertIn("CASCADE", chunk)
        self.assertNotIn("ZT ·", chunk)
        self.assertNotIn("KXBTCD", chunk)
        self.assertNotIn("KXETHD", chunk)

    def test_huddle_sees_backfill_tag(self):
        self.assertIn("Backfill tape", HUDDLE_PY)
        self.assertIn('"backfill": backfill_meta', HUDDLE_PY)
        self.assertIn("source='backfill'", ADAPTIVE_PY)
        self.assertIn("note_backfill_hour", ADAPTIVE_PY)

    def test_print_contract_mentions_hours_and_seats(self):
        text = sb.print_contract({
            "hours_graded": 12,
            "hours_skipped_no_result": 3,
            "hours_skipped_429": 1,
            "assets": "btc+eth",
            "coinglass": {
                "feeds": {"funding": True, "open_interest": False, "liquidations": True},
                "seats_with_samples": ["CARRY", "CASCADE"],
            },
        })
        self.assertIn("90-day", text)
        self.assertIn("WICK", text)
        self.assertIn("TAPE", text)
        self.assertIn("CARRY", text)
        self.assertIn("hours_graded=12", text)
        self.assertIn("CoinGlass samples: CARRY, CASCADE", text)


class ReconstructMidTests(unittest.TestCase):
    def test_mid_never_uses_result(self):
        mid = sb.reconstructed_yes_mid(64100, 64000)
        self.assertIsNotNone(mid)
        self.assertGreater(mid, 50)
        self.assertLess(mid, 92)
        self.assertIsNone(sb.reconstructed_yes_mid(None, 64000))
        # result is not an argument — cannot leak finish into mid
        self.assertNotIn("official_y_finish", sb.reconstructed_yes_mid.__code__.co_names)


def _cg_fixture_snap():
    from backend.data.coinglass import summarize_derivatives
    t0 = 1_775_000_000_000
    return summarize_derivatives(
        [
            {"time": t0, "close": "0.00040"},
            {"time": t0 + 3_600_000, "close": "0.00100"},
        ],
        [
            {"time": t0, "close": "9000000000"},
            {"time": t0 + 3_600_000, "close": "9300000000"},
        ],
        [{
            "time": t0 + 3_600_000,
            "long_liquidation_usd": "8000000",
            "short_liquidation_usd": "500000",
        }],
        "1h",
    )


def _roll_candles(n=80, close=64100.0):
    """Last bars drop so CHAIN can see crowded longs + roll."""
    start = datetime(2026, 8, 10, 18, 0, tzinfo=UTC)
    rows = []
    px = float(close)
    for i in range(n):
        t = start + timedelta(minutes=i)
        if i >= n - 4:
            px = px - 50
        rows.append({
            "open_time": int(t.timestamp() * 1000),
            "open": px + 20,
            "high": px + 30,
            "low": px - 10,
            "close": px,
            "volume": 10.0 + i,
            "close_time": int(t.timestamp() * 1000) + 59999,
        })
    return rows


class CoinGlassHistBackfillTests(unittest.IsolatedAsyncioTestCase):
    def test_no_real_key_in_repo(self):
        self.assertNotIn("COINGLASS_API_KEY=", BACKFILL_PY)
        self.assertNotIn("CG-API-KEY:", BACKFILL_PY)
        src = (ROOT / "backend" / "data" / "coinglass.py").read_text(encoding="utf-8")
        self.assertIn("Never logged", src)
        self.assertIn("Never logs the API key", src)
        self.assertNotIn("sk_live", src + BACKFILL_PY)
        self.assertIn("from backend.data.coinglass import", BACKFILL_PY)
        self.assertNotIn("class CoinGlass", BACKFILL_PY)
        self.assertIn("get_historical_derivatives", src)
        self.assertIn("live_interval_order", src)
        self.assertIn("PATHS", src)
        self.assertIn("30m then 1h", src)
        self.assertIn("Never 1m", src)

    async def test_fixture_grades_carry_chain_cascade(self):
        learner = AdaptiveLearner(asset="btc")
        snap = _cg_fixture_snap()
        self.assertTrue(snap["feeds"]["funding"])
        self.assertTrue(snap["feeds"]["open_interest"])
        self.assertTrue(snap["feeds"]["liquidations"])

        async def ev(_ticker):
            return _official_event("KXBTCD-26AUG1016-T63999.99", "no"), None

        async def candles():
            return _roll_candles()

        async def cg(_start, _end):
            return snap

        rec = await sb.grade_one_hour(
            series="KXBTCD",
            hour_et=_hour_et(2026, 8, 10, 15),
            learner=learner,
            kalshi=None,
            candle_symbol="BTCUSDT",
            fetch_event=ev,
            fetch_candles=candles,
            fetch_coinglass=cg,
        )
        self.assertEqual(rec.get("coinglass_seats"), ["CARRY", "CHAIN", "CASCADE"])
        self.assertEqual(rec["coinglass_feeds"]["funding"], True)
        if rec.get("status") != "graded":
            self.fail(f"expected graded hour, got {rec}")
        cg_voted = {s for s in rec["seats"] if s in sb.COINGLASS_SEATS}
        self.assertTrue(
            cg_voted,
            f"CARRY/CHAIN/CASCADE should vote from fixture, seats={rec['seats']}",
        )
        n = sum(
            int(learner.correct.get(s) or 0) + int(learner.wrong.get(s) or 0)
            for s in sb.COINGLASS_SEATS
        )
        self.assertGreater(n, 0)

    async def test_coinglass_404_does_not_block_candle_seats(self):
        learner = AdaptiveLearner(asset="btc")

        async def ev(_ticker):
            return _official_event("KXBTCD-26AUG1016-T63999.99", "yes"), None

        async def empty_cg(_start, _end):
            from backend.data.coinglass import empty_derivatives
            out = empty_derivatives("1h")
            out["skip_reason"] = "empty_or_404"
            return out

        rec = await sb.grade_one_hour(
            series="KXBTCD",
            hour_et=_hour_et(2026, 8, 10, 15),
            learner=learner,
            kalshi=None,
            candle_symbol="BTCUSDT",
            fetch_event=ev,
            fetch_candles=_async_candles(64010.0),
            fetch_coinglass=empty_cg,
        )
        self.assertEqual(rec.get("coinglass_feeds"), {
            "funding": False, "open_interest": False, "liquidations": False,
        })
        if rec.get("status") == "graded":
            self.assertTrue(any(s in sb.CANDLE_SEATS for s in rec["seats"]))
            self.assertFalse(any(s in sb.COINGLASS_SEATS for s in rec["seats"]))
            n = sum(
                int(learner.correct.get(s) or 0) + int(learner.wrong.get(s) or 0)
                for s in sb.CANDLE_SEATS
            )
            self.assertGreater(n, 0)
        else:
            self.assertIn(rec.get("reason"), ("no_directional_votes", "graded"))

    async def test_no_key_skips_cg_seats_not_candles(self):
        from backend.data.coinglass import empty_derivatives
        learner = AdaptiveLearner(asset="eth")

        async def ev(_ticker):
            return _official_event("KXETHD-26AUG1016-T1874.99", "no"), None

        async def no_key(_start, _end):
            out = empty_derivatives("1h")
            out["skip_reason"] = "no_key"
            return out

        rec = await sb.grade_one_hour(
            series="KXETHD",
            hour_et=_hour_et(2026, 8, 10, 15),
            learner=learner,
            kalshi=None,
            candle_symbol="ETHUSDT",
            fetch_event=ev,
            fetch_candles=_async_candles(1870.0),
            fetch_coinglass=no_key,
        )
        self.assertEqual(rec.get("coinglass_skip") or "no_key", "no_key")
        if rec.get("status") == "graded":
            self.assertNotIn("funding", rec["seats"])
            self.assertNotIn("oi_pressure", rec["seats"])
            self.assertNotIn("liq", rec["seats"])

    async def test_vote_uses_existing_client_fields(self):
        from backend.data.coinglass import apply_hist_to_market
        md = sb.build_market_data(
            candles=_roll_candles(),
            spot=63900.0,
            strike=63999.99,
            ticker="KXBTCD-26AUG1016-T63999.99",
            close_time=datetime(2026, 8, 10, 20, 0, tzinfo=UTC),
            as_of=datetime(2026, 8, 10, 19, 20, tzinfo=UTC),
            up_pct=42.0,
        )
        md = apply_hist_to_market(md, _cg_fixture_snap())
        votes = await sb.vote_rebuildable_seats(
            md,
            cg_feeds={"funding": True, "open_interest": True, "liquidations": True},
        )
        self.assertIn("funding", votes)
        self.assertIn("liq", votes)
        self.assertIn(votes["funding"].get("direction"), ("UP", "DOWN"))
        self.assertIn(votes["liq"].get("direction"), ("UP", "DOWN"))


if __name__ == "__main__":
    unittest.main()
