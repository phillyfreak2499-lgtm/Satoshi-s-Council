"""
Council orchestrator – wires pipeline, agents, leader, store, and continuous loop.
Includes nested sub-council micro-bots behind each specialist.
"""
from __future__ import annotations
import asyncio
import inspect
import time
from typing import Any, Dict, List
from datetime import datetime, timezone
from pathlib import Path
from loguru import logger

from backend.data.pipeline import DataPipeline
from backend.agents.candle import pattern_specialist_for_asset
from backend.agents.volume import VolumeSpecialist
from backend.agents.momentum import MomentumSpecialist
from backend.agents.orderflow import OrderFlowSpecialist
from backend.agents.funding import FundingSpecialist
from backend.agents.regime import RegimeSpecialist
from backend.agents.volatility import VolatilitySpecialist
from backend.agents.oi_pressure import OIPressureSpecialist
from backend.agents.streak import StreakSpecialist
from backend.agents.odds import OddsSpecialist
from backend.agents.strike import StrikeSpecialist
from backend.agents.session_tod import SessionTodSpecialist
from backend.agents.whale import WhaleSpecialist
from backend.agents.quorum import QuorumSpecialist
from backend.agents.panic import PanicSpecialist
from backend.agents.cheap import CheapSpecialist
from backend.agents.spotlag import SpotLagSpecialist
from backend.agents.exhaust import ExhaustSpecialist
from backend.agents.news import NewsSpecialist
from backend.agents.liq import LiqSpecialist
from backend.agents.guardian import GuardianBot
from backend.agents.law import LawBot, apply_find_out_to_signals
from backend.agents.leader import Leader
from backend.agents.window_memory import WindowMemory
from backend.agents.subs import run_all_subs, synthesize_from_subs
from backend.learning.adaptive import AdaptiveLearner
from backend.storage.db import PerformanceStore
from backend.config import settings
from backend.learning.regime_keys import regime_from_market, regime_from_call
from backend.services.huddle import NightlyHuddle
from backend.services.runtime_settings import runtime_settings
from backend.agents.chair_gates import (
    apply_hard_mute_to_signals,
    classify_wait_reason,
    color_counts_from_signals,
    collect_official_results,
    count_paper_locks_today,
    lock_time_strike,
    quorum_peer_dirs,
    stamp_signal_settle_keys,
    eth_paper_lock_blocked,
    eth_settled_n_for_zach,
    btc_shadow_pick,
    eth_shadow_pick,
    is_btc_shadow_row,
    is_shadow_row,
    event_ticker_from_kalshi_ticker,
    known_official_market,
    lifetime_n_for_zach,
    official_y_finish,
    odds_to_cents,
    parse_book_depth,
    pick_settle_spot,
    stuck_hours_open,
    tape_backfill_stats,
    window_minutes_from_times,
)


class Council:
    def __init__(
        self,
        asset: str = "btc",
        leader_name: str = "satoshi",
        series_ticker: str | None = None,
        symbol: str | None = None,
    ):
        self.asset = (asset or "btc").lower()
        self.leader_name = (leader_name or "satoshi").lower()
        self.pipeline = DataPipeline(
            asset=self.asset,
            series_ticker=series_ticker,
            symbol=symbol,
        )
        self.store = PerformanceStore()
        self.learner = AdaptiveLearner(asset=self.asset)
        self.leader = Leader(learner=self.learner)
        self.wm = WindowMemory()
        self.law = LawBot()
        all_agents = [
            pattern_specialist_for_asset(self.asset),
            VolumeSpecialist(),
            MomentumSpecialist(),
            OrderFlowSpecialist(),
            FundingSpecialist(),
            RegimeSpecialist(),
            VolatilitySpecialist(),
            OIPressureSpecialist(),
            StreakSpecialist(),
            OddsSpecialist(),
            StrikeSpecialist(),
            SessionTodSpecialist(),
            WhaleSpecialist(),
            QuorumSpecialist(),
            PanicSpecialist(),
            CheapSpecialist(),
            SpotLagSpecialist(),
            ExhaustSpecialist(),
            NewsSpecialist(),
            LiqSpecialist(),
            GuardianBot(),
            self.law,
        ]
        # ETH: thinner core roster for clarity + CPU
        if self.asset == "eth":
            core = {
                x.strip().lower()
                for x in str(getattr(settings, "ETH_CORE_AGENTS",
                    "candle_eth,volume,momentum,orderflow,odds,strike,session_tod,quorum,cheap,panic,whale,funding,oi_pressure,liq,volatility,exhaust")).split(",")
                if x.strip()
            }
            # Always keep guardian + law
            core |= {"guardian", "law"}
            self.agents = [
                a for a in all_agents
                if getattr(a, "name", None) in core
                or getattr(a, "agent_name", None) in core
                or a is self.law
            ]
            if len(self.agents) < 5:
                self.agents = all_agents  # safety fallback
        else:
            self.agents = all_agents
        self.latest_state: Dict[str, Any] = {}
        self._task: asyncio.Task | None = None
        self.running = False
        self._last_learned_ids: set = set()
        self._shadow_book: list = []
        self._wait_snapshot: Dict[str, Any] | None = None
        self._last_settle_review = None
        self._last_spot: float | None = None
        self._btc_lead: Dict[str, Any] | None = None
        self.huddle = NightlyHuddle()

    def attach_btc_lead(self, lead: Dict[str, Any] | None) -> None:
        """Vitalik input: Satoshi move / lock / hour spot delta."""
        self._btc_lead = lead if isinstance(lead, dict) else None

    async def start(self):
        await self.store.init()
        try:
            await self.store.ensure_eth_display_reset()
        except Exception as e:
            logger.debug(f"ETH display reset skip: {e}")
        try:
            await self.store.ensure_btc_15m_display_reset()
        except Exception as e:
            logger.debug(f"BTC 15m display reset skip: {e}")
        # Seed multi-window memory from recent settled calls
        try:
            rows = []
            if hasattr(self.store, "recent_settled_calls"):
                rows = await self.store.recent_settled_calls(24, asset=self.asset)
            elif hasattr(self.store, "get_recent_settled"):
                rows = await self.store.get_recent_settled(24)
            if rows:
                n = self.wm.seed_from_store(rows)
                logger.info(f"WindowMemory seeded with {n} settled windows")
        except Exception as e:
            logger.debug(f"WindowMemory seed: {e}")
        # Load the on-disk brain. Do not rebuild over it — a short replay
        # of recent settles would wipe a long-run learner (seen live: 17777 → 2).
        try:
            loaded = False
            try:
                loaded = bool(self.learner.load())
            except Exception:
                loaded = False
            if loaded:
                self.leader.sync_from_learner()
                logger.info("Adaptive learner loaded from disk — not rebuilding")
            else:
                logger.info(
                    "Adaptive learner file missing — leaving weights; "
                    "learn_from_settled runs on new hour-close grades only"
                )
        except Exception as e:
            logger.debug(f"Adaptive load: {e}")
        # Paint lifetime log / huddle from disk before the first analyze_once.
        # Does not create, truncate, or delete SQLite / brain files.
        try:
            await self.hydrate_persisted_desk()
        except Exception as e:
            logger.debug(f"desk hydrate skip ({self.asset}): {e}")
        try:
            self.ensure_seat_shell("warming")
        except Exception as e:
            logger.debug(f"seat shell skip ({self.asset}): {e}")
        try:
            n = await self.sweep_official_finishes()
            if n:
                logger.info(f"[{self.asset}] Official closer swept {n} open hour(s)")
        except Exception as e:
            logger.debug(f"official closer sweep skip ({self.asset}): {e}")
        self.running = True
        self._task = asyncio.create_task(self._loop())
        logger.info(f"Council continuous analysis started asset={self.asset} leader={self.leader_name}")

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self.pipeline.close()
        await self.store.close()

    async def _loop(self):
        # BEAST adaptive cadence: HOT when odds/spot moving, FLAT when quiet
        while self.running:
            t0 = asyncio.get_event_loop().time()
            try:
                await self.analyze_once()
            except Exception as e:
                logger.exception(f"Analysis cycle error: {e}")
            elapsed = asyncio.get_event_loop().time() - t0
            try:
                prof = runtime_settings.profile()
                if self.asset == "eth":
                    interval = float(getattr(settings, "ANALYSIS_INTERVAL_ETH", 2.0))
                elif self.asset == "btc":
                    interval = float(getattr(settings, "ANALYSIS_INTERVAL_BTC", 2.0))
                else:
                    interval = float(prof.get("analysis_interval", getattr(settings, "ANALYSIS_INTERVAL", 2.0)))
                st = self.latest_state or {}
                mkt = st.get("market") or {}
                dec = (st.get("decision") or {}).get("direction")
                hot = dec in (
                    "UP", "DOWN", "UP_HOLD", "DOWN_HOLD", "SWAP",
                    "BOTH", "LONG_UP", "LONG_DOWN", "REDUCE_UP", "REDUCE_DOWN",
                )
                div = mkt.get("spot_divergence_bps") or 0
                if float(div) >= 8:
                    hot = True
                if hot:
                    interval = float(prof.get("analysis_interval_hot", 1.0))
                elif dec == "WAIT":
                    interval = float(prof.get("analysis_interval_flat", 3.0))
            except Exception:
                interval = float(getattr(settings, "ANALYSIS_INTERVAL", 1.5))
            delay = max(0.2, interval - elapsed)
            await asyncio.sleep(delay)

    def _last_spot_path(self) -> Path:
        root = Path(getattr(settings, "DATA_DIR", None) or (Path(__file__).resolve().parent.parent.parent / "data"))
        return root / "last-spot.json"

    def _persist_last_spot(self, spot: float) -> None:
        """Small cache only — never writes brain / council.db / learning JSON."""
        import json
        path = self._last_spot_path()
        data: Dict[str, Any] = {}
        try:
            if path.is_file():
                raw = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    data = raw
        except Exception:
            data = {}
        data[self.asset] = {"price": float(spot), "ts": time.time()}
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data), encoding="utf-8")
        except OSError:
            pass

    def _load_persisted_spot(self) -> float | None:
        import json
        path = self._last_spot_path()
        try:
            if not path.is_file():
                return None
            raw = json.loads(path.read_text(encoding="utf-8"))
            rec = (raw or {}).get(self.asset) if isinstance(raw, dict) else None
            if not isinstance(rec, dict):
                return None
            return pick_settle_spot(rec.get("price"), None)
        except Exception:
            return None

    def _usable_spot(self, price: Any = None, market_data: Dict[str, Any] | None = None) -> float | None:
        """Prefer the 60s CFB research print; never persist a lone last-tick wick as official."""
        md = market_data if isinstance(market_data, dict) else {}
        research = pick_settle_spot(
            md.get("research_spot") or md.get("cfb_avg_60s") or price,
            None,
        )
        if research is not None:
            self._last_spot = research
            try:
                self._persist_last_spot(research)
            except Exception:
                pass
            return research
        pipe = getattr(self, "pipeline", None)
        last_good = getattr(pipe, "last_good", None) if pipe is not None else None
        lg_price = None
        if isinstance(last_good, dict):
            lg_price = (
                last_good.get("research_spot")
                or last_good.get("cfb_avg_60s")
                or last_good.get("current_price")
                or last_good.get("binance_price")
                or last_good.get("coinbase_price")
            )
        st = self.latest_state or {}
        mkt = st.get("market") or {}
        spot = pick_settle_spot(price, getattr(self, "_last_spot", None))
        if spot is None:
            spot = pick_settle_spot(lg_price, mkt.get("current_price") or mkt.get("price"))
        if spot is None:
            spot = self._load_persisted_spot()
        if spot is not None:
            self._last_spot = spot
            try:
                self._persist_last_spot(spot)
            except Exception:
                pass
        return spot

    async def _official_results_for_opens(self) -> Dict[str, Any]:
        """Fetch official Kalshi yes/no for every OPEN paper hour. No model. No 40-cap."""
        import inspect
        results: Dict[str, Any] = {}
        opens = []
        getter = getattr(self.store, "list_open_calls", None)
        if callable(getter):
            # Every OPEN row — a BTC loop must still see a finalized ETH ticker.
            maybe = getter()
            opens = await maybe if inspect.isawaitable(maybe) else (maybe or [])
        if not isinstance(opens, list):
            opens = []
        tickers: list[str] = []
        for row in opens:
            if not isinstance(row, dict):
                continue
            t = row.get("ticker")
            known = known_official_market(t, row.get("id"))
            if known:
                results[t] = known
                if row.get("id") is not None:
                    results[row["id"]] = known
            if t:
                tickers.append(str(t).strip())
        unique = []
        seen = set()
        for t in tickers:
            if t and t not in seen:
                seen.add(t)
                unique.append(t)
        client = getattr(getattr(self, "pipeline", None), "kalshi", None)

        def _kalshi_fn(name: str):
            if client is None:
                return None
            if not callable(getattr(type(client), name, None)):
                return None
            fn = getattr(client, name, None)
            return fn if callable(fn) else None

        fn_event = _kalshi_fn("get_event")
        fn_market = _kalshi_fn("get_market")

        async def _await(maybe):
            return await maybe if inspect.isawaitable(maybe) else (maybe or {})

        # One event fetch per hour covers every strike on that tape.
        events = []
        ev_seen = set()
        leftover = []
        for t in unique:
            ev = event_ticker_from_kalshi_ticker(t)
            if ev and ev not in ev_seen:
                ev_seen.add(ev)
                events.append(ev)
            if not ev:
                leftover.append(t)
        if callable(fn_event):
            for ev in events:
                try:
                    body = await _await(fn_event(ev))
                except Exception:
                    body = {}
                pulled = collect_official_results(body)
                for ticker, market in pulled.items():
                    results[ticker] = market
            have = {str(k) for k in results if official_y_finish(results.get(k))}
            leftover.extend([t for t in unique if t not in have])
        elif callable(fn_market):
            leftover = list(unique)
        # Dedup leftover while keeping order
        rest = []
        rest_seen = set()
        for t in leftover:
            if t and t not in rest_seen:
                rest_seen.add(t)
                rest.append(t)
        if callable(fn_market):
            for ticker in rest:
                if official_y_finish(results.get(ticker)):
                    continue
                try:
                    market = await _await(fn_market(ticker))
                except Exception:
                    market = {}
                pulled = collect_official_results(market) if isinstance(market, dict) else {}
                if pulled:
                    for tk, mk in pulled.items():
                        results[tk] = mk
                elif isinstance(market, dict) and official_y_finish(market):
                    results[ticker] = market
        for row in opens:
            if not isinstance(row, dict):
                continue
            t = row.get("ticker")
            if t and official_y_finish(results.get(t)) and row.get("id") is not None:
                results[row["id"]] = results[t]
        stats = tape_backfill_stats(opens, results)
        self._last_tape_backfill = dict(stats)
        logger.info(
            f"[{self.asset}] Tape scan: {stats['open_n']} OPEN rows · "
            f"{stats['unique_tickers']} tickers · {stats['finalized_tickers']} finalized"
        )
        return results

    def _grade_council_from_results(self, kalshi_results: Any) -> None:
        """
        Score the Round Table's OWN decisions against the official finishes we
        just resolved, so the council earns a real finish hit-rate in the process
        metrics — independent of the scalp engine. Advisory: never raises, never
        touches paper P&L.
        """
        if not isinstance(kalshi_results, dict) or not kalshi_results:
            return
        try:
            from backend.services.process_log import process_log
            pl = process_log()
            for ticker, result in kalshi_results.items():
                if not ticker:
                    continue
                try:
                    fin = official_y_finish(result)
                except Exception:
                    fin = None
                if fin in ("UP", "DOWN"):
                    pl.settle_finish(ticker, fin)
        except Exception as e:
            logger.debug(f"council process grade skip: {e}")

    async def sweep_official_finishes(self) -> int:
        """Startup/loop closer: write y_finish from official result, then learn."""
        kalshi_results = {}
        try:
            kalshi_results = await self._official_results_for_opens()
        except Exception as e:
            logger.debug(f"Kalshi official fetch skip: {e}")
            kalshi_results = {}
        settled_n = 0
        try:
            _mkt = (self.latest_state or {}).get("market") or {}
            settled_n = await self.store.settle_expired_calls(
                current_price=_mkt.get("current_price") or _mkt.get("price"),
                asset=None,
                kalshi_results=kalshi_results,
            )
            self._grade_council_from_results(kalshi_results)
        except Exception as e:
            logger.debug(f"Settle skip: {e}")
        try:
            # Whole tape, not the first 5. This is the calibration set.
            await self._learn_from_new_settlements(limit=2000, max_learn=2000)
        except Exception as e:
            logger.debug(f"Adaptive learn skip: {e}")
        stats = dict(getattr(self, "_last_tape_backfill", {}) or {})
        stats["graded_n"] = int(settled_n or 0)
        self._last_tape_backfill = stats
        if settled_n or stats.get("open_n"):
            logger.info(
                f"[{self.asset}] Tape backfill graded {settled_n} hour(s) "
                f"(OPEN {stats.get('open_n', 0)} · "
                f"tickers {stats.get('unique_tickers', 0)} · "
                f"finalized {stats.get('finalized_tickers', 0)})"
            )
        return settled_n

    async def settle_due_windows(
        self,
        current_price: Any = None,
        up_pct: Any = None,
        down_pct: Any = None,
        floor_strike: Any = None,
        close_time: Any = None,
    ) -> int:
        """
        Finish-only settle + learn from official Kalshi result.
        Later-hour spot is not y_finish.
        """
        st = self.latest_state or {}
        mkt = st.get("market") or {}
        if up_pct is None:
            up_pct = mkt.get("up_pct")
        if down_pct is None:
            down_pct = mkt.get("down_pct")
        if close_time is None:
            close_time = mkt.get("close_time")
        kalshi_results: Dict[str, Any] = {}
        try:
            kalshi_results = await self._official_results_for_opens()
        except Exception as e:
            logger.debug(f"Kalshi close-result fetch skip: {e}")
        settled_n = 0
        try:
            settled_n = await self.store.settle_expired_calls(
                current_price=(current_price if current_price is not None else (mkt.get("current_price") or mkt.get("price"))),
                up_pct=up_pct,
                down_pct=down_pct,
                floor_strike=None,
                asset=None,
                kalshi_results=kalshi_results,
            )
            self._grade_council_from_results(kalshi_results)
            try:
                due = False
                if close_time:
                    ct_ = datetime.fromisoformat(str(close_time).replace("Z", "+00:00"))
                    due = datetime.now(timezone.utc) >= ct_
                if due and hasattr(self.leader, "_clear_window_lock"):
                    self.leader._clear_window_lock()
            except Exception:
                pass
        except Exception as e:
            logger.debug(f"Settle skip: {e}")
        try:
            await self._learn_from_new_settlements()
        except Exception as e:
            logger.debug(f"Adaptive learn skip: {e}")
        return settled_n

    async def _maybe_record_shadow(
        self,
        decision: Dict[str, Any] | None,
        ticker: str | None,
        close_time: str | None,
        *,
        book: str,
    ) -> None:
        """
        Persist one shadow pick per hour. Stake 0. Does not count as a Chair lock.
        ETH: a BTC-impulse veto is stored so we can grade whether the veto was right.
        BTC: WAIT-hour lean only — never becomes a Chair lock or Follower order.
        """
        book = str(book or "").strip().lower()
        asset = str(self.asset or "").lower()
        if book == "eth":
            if asset not in ("eth", "ethereum"):
                return
            pick_key = "eth_shadow_pick"
            build = eth_shadow_pick
            store_fn = "record_eth_shadow_pick"
            label = "ETH"
        elif book == "btc":
            if asset not in ("btc", "bitcoin"):
                return
            pick_key = "btc_shadow_pick"
            build = btc_shadow_pick
            store_fn = "record_btc_shadow_pick"
            label = "BTC"
        else:
            return
        if not ticker or not isinstance(decision, dict):
            return
        if decision.get("window_locked"):
            return
        lc = decision.get("locked_call")
        if isinstance(lc, dict) and lc.get("locked"):
            return
        pick = decision.get(pick_key)
        if not isinstance(pick, dict):
            side = decision.get("shadow_direction") or decision.get("lean")
            pick = build(
                self.asset,
                side,
                decision.get("shadow_confidence") or decision.get("confidence") or 0,
                ask=None,
                strike=decision.get("floor_strike"),
                vetoed=False,
                ticker=ticker,
            )
        if not pick:
            return
        fn = getattr(self.store, store_fn, None)
        if not callable(fn):
            return
        try:
            maybe = fn(
                ticker=ticker,
                direction=pick.get("side") or pick.get("direction"),
                confidence=int(pick.get("confidence") or 0),
                close_time=close_time,
                side_ask=pick.get("ask"),
                floor_strike=pick.get("strike") or decision.get("floor_strike"),
                vetoed=bool(pick.get("vetoed")),
            )
            if inspect.isawaitable(maybe):
                await maybe
        except Exception as e:
            logger.debug(f"{label} shadow persist skip: {e}")

    async def _maybe_record_eth_shadow(
        self,
        decision: Dict[str, Any] | None,
        ticker: str | None,
        close_time: str | None,
    ) -> None:
        """
        Persist one ETH shadow pick per hour. Stake 0. Does not count as a Chair lock.
        A BTC-impulse veto is stored so we can grade whether the veto was right.
        """
        await self._maybe_record_shadow(decision, ticker, close_time, book="eth")

    async def _maybe_record_btc_shadow(
        self,
        decision: Dict[str, Any] | None,
        ticker: str | None,
        close_time: str | None,
    ) -> None:
        """
        Persist one BTC WAIT-hour shadow pick. Stake 0. Does not count as a Chair lock.
        Never auto-locks BTC and never arms Follower.
        """
        await self._maybe_record_shadow(decision, ticker, close_time, book="btc")

    async def _restore_open_lock(self) -> None:
        """Persist one-call integrity across process restart."""
        if getattr(self, "_lock_restored", False):
            return
        self._lock_restored = True
        try:
            if self.leader._entry_dir or self.leader._active_dir():
                return
            acc = await self.store.get_accuracy(asset=self.asset)
            opens = acc.get("open") or acc.get("open_log") or []
            if not isinstance(opens, list):
                return
            for row in opens:
                if not isinstance(row, dict):
                    continue
                if is_shadow_row(row) or row.get("shadow") or row.get("kind") in ("eth_shadow", "btc_shadow"):
                    continue
                direction = row.get("direction") or ""
                side = "UP" if direction in ("UP", "UP_HOLD") else ("DOWN" if direction in ("DOWN", "DOWN_HOLD") else None)
                if side not in ("UP", "DOWN"):
                    continue
                ticker = row.get("ticker") or ""
                try:
                    from backend.learning.btc15m import is_btc_15m_ticker
                    if ticker and is_btc_15m_ticker(ticker):
                        continue
                except Exception:
                    if str(ticker).upper().startswith("KXBTC15M"):
                        continue
                conf = int(row.get("confidence") or 70)
                up = row.get("entry_side_pct") or row.get("open_price")
                self.leader._set_window_lock(
                    ticker, side, conf, 0.0, up_pct=up, call_phase="entry"
                )
                if row.get("close_time"):
                    self.leader._locked_window = str(row["close_time"])
                logger.info(
                    f"[{self.asset}/{self.leader_name}] Restored open lock {side} "
                    f"ticker={ticker}"
                )
                break
        except Exception as e:
            logger.debug(f"lock restore skip ({self.asset}): {e}")

    def _attach_path_context(
        self,
        market_data: Dict[str, Any],
        ticker: str | None,
        close_time: str | None,
    ) -> None:
        """Inject the live 15m path book so specialists keep gathering all 15 minutes."""
        if not ticker:
            return
        try:
            from backend.learning.btc15m import is_btc_15m_ticker
            if not is_btc_15m_ticker(ticker):
                return
        except Exception:
            if not str(ticker).upper().startswith("KXBTC15M"):
                return
        market_data["ticker"] = ticker
        if close_time:
            market_data["close_time"] = close_time
        try:
            market_data["path_book"] = self.leader.path_book_snapshot(ticker, close_time) or {}
        except Exception:
            market_data.setdefault("path_book", {})
        try:
            from backend.learning.btc15m_path import is_chalk, real_yes_no_asks
            km = market_data.get("kalshi_market") or {}
            yes, no = real_yes_no_asks(
                yes_ask=market_data.get("kalshi_yes_ask") or km.get("yes_ask") or market_data.get("yes_ask"),
                no_ask=market_data.get("kalshi_no_ask") or km.get("no_ask") or market_data.get("no_ask"),
                yes_bid=market_data.get("kalshi_yes_bid") or km.get("yes_bid"),
                no_bid=market_data.get("kalshi_no_bid") or km.get("no_bid"),
            )
            market_data["path_quotes"] = {
                "yes_ask": yes,
                "no_ask": no,
                "chalk": bool(is_chalk(yes) or is_chalk(no)),
            }
        except Exception:
            market_data.setdefault("path_quotes", {})

    async def analyze_once(self) -> Dict[str, Any]:
        try:
            await self._restore_open_lock()
        except Exception:
            pass
        # Refresh edge stats before synthesis so WAIT bar tracks lifetime log
        try:
            acc = await self.store.get_accuracy(asset=self.asset)
            self.leader.update_edge_from_accuracy(acc)
            rows = list(acc.get("log") or []) + list(acc.get("open") or acc.get("open_log") or [])
            self._paper_locks_today = count_paper_locks_today(rows, asset=self.asset)
        except Exception:
            pass

        # Nightly 3:00–3:15 AM CT huddle (one 15m cool-down + learning consolidate)
        try:
            await self.huddle.maybe_run(self.store, self.learner, self.leader, law=self.law)
            self.leader.cool_down_bump = float(self.huddle.cool_down_bump())
        except Exception as e:
            self.leader.cool_down_bump = 0.0
            logger.debug(f"Huddle cycle: {e}")

        try:
            await self.settle_due_windows()
        except Exception:
            pass
        market_data = await self.pipeline.fetch()
        if self._btc_lead:
            market_data["btc_lead"] = self._btc_lead
        # Multi-window memory: tick update + inject snapshot for specialists
        try:
            km = market_data.get("kalshi_market") or {}
            ticker = (
                market_data.get("market_ticker")
                or km.get("ticker")
                or km.get("market_ticker")
            )
            up_pct = market_data.get("up_pct")
            price = market_data.get("current_price")
            mins_left = market_data.get("mins_left")
            if mins_left is None:
                close_t = km.get("close_time") or market_data.get("close_time")
                if close_t:
                    try:
                        from backend.learning.regime_keys import parse_mins_left
                        mins_left = parse_mins_left(close_t)
                    except Exception:
                        mins_left = None
            try:
                from backend.learning.btc15m import window_minutes_for
                _wmins = window_minutes_for(asset=self.asset, ticker=ticker)
            except Exception:
                _wmins = 15.0 if self.asset == "btc" else 60.0
            self.wm.on_tick(ticker, up_pct, price, mins_left, window_minutes=_wmins)
            # ETH 1H: stamp Chair lock so mid/final specialists hold entry.
            # BTC 15m: Chair lock is a path book — keep specialists live the full window.
            stamp_entry = True
            try:
                from backend.learning.btc15m import is_btc_15m_ticker
                if ticker and is_btc_15m_ticker(ticker):
                    stamp_entry = False
            except Exception:
                if ticker and str(ticker).upper().startswith("KXBTC15M"):
                    stamp_entry = False
            if (
                stamp_entry
                and getattr(self.leader, "_entry_dir", None)
                and not self.wm.live.entry_dir
            ):
                self.wm.set_entry(
                    self.leader._entry_dir,
                    int(getattr(self.leader, "_entry_conf", 0) or 0),
                    getattr(self.leader, "_entry_up_pct", None),
                )
            market_data["wm"] = self.wm.snapshot()
            market_data["phase"] = self.wm.live.phase
            if mins_left is not None:
                market_data["mins_left"] = mins_left
        except Exception as e:
            logger.debug(f"WindowMemory tick: {e}")
            market_data.setdefault("wm", {})
        try:
            subs_map = run_all_subs(market_data)
        except Exception as e:
            logger.warning(f"subs failed (continuing): {e}")
            subs_map = {}

        ticker = None
        close_time = None
        km = market_data.get("kalshi_market") or {}
        if isinstance(km, dict):
            ticker = km.get("ticker")
            close_time = km.get("close_time")
        entry_price = self._usable_spot(
            market_data.get("research_spot")
            or market_data.get("cfb_avg_60s")
            or market_data.get("current_price"),
            market_data,
        )
        if entry_price is not None:
            market_data["current_price"] = entry_price

        # Kalshi odds (0-100) for path grading
        def _odds_pct(raw):
            if raw is None:
                return None
            try:
                v = float(raw)
            except Exception:
                return None
            # dollars 0-1 or already percent
            if v <= 1.0:
                v = v * 100.0
            return max(0.0, min(100.0, v))

        # Prefer mid (bid+ask)/2 so path grading isn't skewed by one side of the book
        yes_bid = _odds_pct(market_data.get("kalshi_yes_bid"))
        yes_ask = _odds_pct(market_data.get("kalshi_yes_ask"))
        if yes_bid is not None and yes_ask is not None:
            up_pct = (yes_bid + yes_ask) / 2.0
        else:
            up_pct = yes_bid if yes_bid is not None else yes_ask
        down_pct = (100.0 - up_pct) if up_pct is not None else None
        if up_pct is not None:
            market_data["up_pct"] = up_pct
            market_data["down_pct"] = down_pct

        # Finish-only settle for THIS asset only (never grade ETH with BTC price)
        await self.settle_due_windows(
            current_price=entry_price,
            up_pct=up_pct,
            down_pct=down_pct,
            floor_strike=market_data.get("kalshi_floor_strike"),
            close_time=close_time,
        )

        # LAW evaluates streak / may trigger lockdown + find-out fixes
        try:
            await self.law.evaluate_after_settle(self.store, self.leader, self.agents)
            self.leader.sync_from_learner()
        except Exception as e:
            logger.debug(f"LAW evaluate skip: {e}")

        # Consume a lockdown slot once per distinct window
        if self.law.is_locked():
            self.law.note_window(ticker)

        self._attach_path_context(market_data, ticker, close_time)

        signals: List = []
        quorum_agent = next((a for a in self.agents if a.name == "quorum"), None)
        # BEAST: evaluate all non-quorum specialists in parallel
        phase1 = [a for a in self.agents if a.name != "quorum"]

        async def _eval_one(agent):
            from backend.agents.base import AgentSignal
            try:
                if agent.name == "law":
                    return await agent.get_signal(market_data)
                fallback = await agent.get_signal(market_data)
                # Candle subs belong to WICK only. CASCADE has no Glass pane —
                # do not inherit the candle council and keep voting on a 401.
                if agent.name in ("candle", "candle_btc", "candle_eth"):
                    subs = subs_map.get(agent.name) or subs_map.get("candle") or []
                else:
                    subs = subs_map.get(agent.name) or []
                merged = synthesize_from_subs(agent.name, agent.category, subs, fallback)
                if agent.name == "regime":
                    merged.features = {**fallback.features, **merged.features}
                    if "aggressiveness" in fallback.features:
                        merged.features["aggressiveness"] = fallback.features["aggressiveness"]
                    merged.reasoning = fallback.reasoning
                    merged.confidence = fallback.confidence
                if agent.name == "guardian":
                    merged.features = {**fallback.features, **merged.features}
                    merged.confidence = fallback.confidence
                    merged.reasoning = fallback.reasoning
                return merged
            except Exception as e:
                logger.error(f"Agent {agent.name} failed: {e}")
                return AgentSignal(agent.name, "WAIT", 0, f"Error: {e}", agent.category, muted=True)

        if bool(runtime_settings.get("parallel_agents", True)):
            signals = list(await asyncio.gather(*[_eval_one(a) for a in phase1]))
        else:
            for agent in phase1:
                signals.append(await _eval_one(agent))

        apply_hard_mute_to_signals(signals, self.learner)
        stamp_signal_settle_keys(signals, ticker, close_time)

        # QUORUM second pass: sees peer colors + historical size/combo stats
        if quorum_agent is not None:
            try:
                if hasattr(quorum_agent, "bind_learner"):
                    quorum_agent.bind_learner(self.learner)
                peer_dirs = quorum_peer_dirs(signals, market_data)
                qsig = quorum_agent.from_peers(peer_dirs, market_data)
                stamp_signal_settle_keys([qsig], ticker, close_time)
                signals.append(qsig)
            except Exception as e:
                logger.error(f"Quorum agent failed: {e}")
                from backend.agents.base import AgentSignal
                signals.append(AgentSignal("quorum", "WAIT", 0, f"Error: {e}", "quorum", muted=True))

        try:
            from backend.agents.base import shape_path_signals
            shape_path_signals(signals, market_data)
        except Exception as e:
            logger.debug(f"path signal shape skip: {e}")

        # Guardian updates
        guardian = next((a for a in self.agents if a.name == "guardian"), None)
        if guardian and isinstance(guardian, GuardianBot):
            guardian.update_health(market_data.get("health", {}), signals)

        # Regime features for Leader
        # (find-out annotation applied after shadow capture when locked)
        open_rows: list = []
        try:
            import inspect
            getter = getattr(self.store, "list_open_calls", None)
            if callable(getter):
                maybe = getter()
                open_rows = await maybe if inspect.isawaitable(maybe) else (maybe or [])
            if not isinstance(open_rows, list):
                open_rows = []
        except Exception:
            open_rows = []
        regime_sig = next((s for s in signals if s.agent_name == "regime"), None)
        regime_features = dict(regime_sig.features) if regime_sig else {}
        # Enrich with split-weight key (session × window phase)
        try:
            rk = regime_from_market(market_data)
            regime_features["regime_key"] = rk
            # Ticker required for per-window Chair lock
            if ticker:
                regime_features["ticker"] = ticker
                regime_features["market_ticker"] = ticker
            # Freshness for lock gate (no ENTRY on stale Kalshi)
            try:
                regime_features["stale"] = bool(market_data.get("stale") or (market_data.get("kalshi") or {}).get("stale"))
                regime_features["kalshi_fetched_at"] = (
                    (market_data.get("kalshi") or {}).get("fetched_at")
                    or market_data.get("fetched_at")
                )
                regime_features["kalshi_healthy"] = bool((market_data.get("health") or {}).get("kalshi", True))
                # strike / series for plaque identity
                regime_features["series_ticker"] = market_data.get("series_ticker") or (market_data.get("kalshi") or {}).get("series_ticker")
                km0 = market_data.get("kalshi_market") if isinstance(market_data.get("kalshi_market"), dict) else {}
                regime_features["floor_strike"] = lock_time_strike(
                    ticker=ticker,
                    floor_strike=market_data.get("kalshi_floor_strike"),
                    cap_strike=market_data.get("kalshi_cap_strike") or km0.get("cap_strike"),
                    strike_price=km0.get("strike_price"),
                )
                regime_features["kalshi_title"] = market_data.get("kalshi_title")
            except Exception:
                pass

            # mins_left for classify fallback
            from backend.learning.regime_keys import parse_mins_left
            km = market_data.get("kalshi_market") or {}
            close_t = km.get("close_time") if isinstance(km, dict) else None
            ml = parse_mins_left(close_t or market_data.get("close_time"))
            if ml is not None:
                regime_features["mins_left"] = ml
            # Stable hourly window id — ATM ticker hops must not clear the lock
            ct_id = close_time or close_t or market_data.get("close_time")
            if ct_id:
                regime_features["close_time"] = ct_id
            open_t = None
            if isinstance(km, dict):
                open_t = km.get("open_time") or km.get("open_ts")
            if open_t:
                regime_features["open_time"] = open_t
            win_mins = window_minutes_from_times(open_t, ct_id)
            if win_mins is None:
                try:
                    from backend.learning.btc15m import window_minutes_for
                    win_mins = window_minutes_for(
                        asset=self.asset,
                        ticker=ticker,
                        series=regime_features.get("series_ticker"),
                    )
                except Exception:
                    win_mins = 15.0 if self.asset == "btc" else 60.0
            regime_features["window_minutes"] = win_mins
            regime_features["asset"] = self.asset
            # Bid-ask spread in cents for Chair gate (top-of-book, not mid alone)
            try:
                bid = market_data.get("kalshi_yes_bid")
                ask = market_data.get("kalshi_yes_ask")
                if bid is not None and ask is not None:
                    b, a = float(bid), float(ask)
                    if b <= 1.0:
                        b *= 100.0
                    if a <= 1.0:
                        a *= 100.0
                    regime_features["spread_cents"] = abs(a - b)
            except Exception:
                pass
            # Book depth — thin size → Chair WAIT
            try:
                depth = parse_book_depth(market_data.get("kalshi_orderbook"))
                regime_features["book_depth"] = depth
                regime_features["kalshi_orderbook"] = market_data.get("kalshi_orderbook")
                if depth.get("yes_bid_sz") is not None:
                    regime_features["book_yes_size"] = depth["yes_bid_sz"]
                if depth.get("no_bid_sz") is not None:
                    regime_features["book_no_size"] = depth["no_bid_sz"]
            except Exception:
                pass
            # Quiet-mode signals (ATR / vol / volume percentile when available)
            try:
                if market_data.get("atr_pct") is not None:
                    regime_features["atr_pct"] = float(market_data["atr_pct"])
                if market_data.get("realized_vol") is not None:
                    regime_features["realized_vol"] = float(market_data["realized_vol"])
                if market_data.get("volume_percentile") is not None:
                    regime_features["volume_percentile"] = float(market_data["volume_percentile"])
                # Fallback: crude ATR from features if agents provided it
                if "atr_pct" not in regime_features and regime_sig and isinstance(regime_sig.features, dict):
                    for k in ("atr_pct", "atr", "realized_vol"):
                        if regime_sig.features.get(k) is not None:
                            regime_features["atr_pct"] = float(regime_sig.features[k])
                            break
            except Exception:
                pass
            if up_pct is not None:
                regime_features["up_pct"] = up_pct
            if down_pct is not None:
                regime_features["down_pct"] = down_pct
            # Paper-fill at the real ask, not mid. Implied NO ask = 100 − yes bid.
            yb = odds_to_cents(market_data.get("kalshi_yes_bid"))
            ya = odds_to_cents(market_data.get("kalshi_yes_ask"))
            nb = odds_to_cents(market_data.get("kalshi_no_bid"))
            na = odds_to_cents(market_data.get("kalshi_no_ask"))
            if yb is not None:
                regime_features["yes_bid"] = yb
            if ya is not None:
                regime_features["yes_ask"] = ya
            elif nb is not None:
                regime_features["yes_ask"] = max(1.0, min(99.0, 100.0 - nb))
            if nb is not None:
                regime_features["no_bid"] = nb
            if na is not None:
                regime_features["no_ask"] = na
            elif yb is not None:
                regime_features["no_ask"] = max(1.0, min(99.0, 100.0 - yb))
            if yb is not None and ya is not None:
                regime_features["yes_mid"] = (yb + ya) / 2.0
            elif up_pct is not None:
                regime_features["yes_mid"] = float(up_pct)
            spot = (
                market_data.get("research_spot")
                or market_data.get("cfb_avg_60s")
                or market_data.get("current_price")
                or market_data.get("spot_price")
            )
            try:
                if spot is not None and float(spot) > 0:
                    regime_features["spot_price"] = float(spot)
                    regime_features["current_price"] = float(spot)
            except (TypeError, ValueError):
                pass
            try:
                rs = market_data.get("research_spot") or market_data.get("cfb_avg_60s")
                if rs is not None and float(rs) > 0:
                    regime_features["research_spot"] = float(rs)
                    regime_features["cfb_avg_60s"] = float(
                        market_data.get("cfb_avg_60s") or rs
                    )
            except (TypeError, ValueError):
                pass
            if market_data.get("research_spot_kind"):
                regime_features["research_spot_kind"] = market_data.get("research_spot_kind")
                regime_features["kind"] = market_data.get("research_spot_kind")
            if market_data.get("research_spot_source"):
                regime_features["research_spot_source"] = market_data.get("research_spot_source")
            regime_features["asset"] = self.asset
            try:
                raw_n = int((self.leader.edge or {}).get("total") or 0)
            except (TypeError, ValueError):
                raw_n = 0
            try:
                # ETH reliability includes graded shadow picks, not just counting locks.
                rel_n = int((self.leader.edge or {}).get("reliability_n") or 0)
            except (TypeError, ValueError):
                rel_n = 0
            stuck = stuck_hours_open(open_rows)
            regime_features["stuck_open"] = stuck
            regime_features["open_rows"] = [
                {"id": r.get("id"), "ticker": r.get("ticker")}
                for r in open_rows
                if isinstance(r, dict)
            ][:24]
            # n=0 until 1062/1063 settle. Chair conf is not P(finish).
            regime_features["settled_n"] = lifetime_n_for_zach(raw_n, open_rows)
            regime_features["lifetime_n"] = regime_features["settled_n"]
            if stuck:
                regime_features["chair_bin_settled_n"] = 0
            else:
                try:
                    hot = ((self.leader.edge or {}).get("chair_bins") or {}).get("90+") or {}
                    regime_features["chair_bin_settled_n"] = int(hot.get("settled") or 0)
                except (TypeError, ValueError):
                    regime_features["chair_bin_settled_n"] = 0
            eth_raw = rel_n if str(self.asset or "").lower() in ("eth", "ethereum") else 0
            regime_features["eth_settled_n"] = eth_settled_n_for_zach(eth_raw, open_rows)
            regime_features["eth_lock_blocked"] = bool(
                eth_paper_lock_blocked(self.asset, regime_features["eth_settled_n"])
            )
            try:
                regime_features["reliability_n"] = int(
                    (self.leader.edge or {}).get("reliability_n")
                    or (self.leader.edge or {}).get("total")
                    or 0
                )
            except (TypeError, ValueError):
                regime_features["reliability_n"] = 0
            try:
                phase_info = self.learner.learning_phase(
                    chair_n=int((self.leader.edge or {}).get("total") or 0)
                ) or {}
                regime_features["learning_phase"] = phase_info.get("phase")
            except Exception:
                regime_features["learning_phase"] = None
            regime_features["paper_locks_today"] = int(getattr(self, "_paper_locks_today", 0) or 0)
            lead = market_data.get("btc_lead") or self._btc_lead
            if isinstance(lead, dict):
                regime_features["btc_lead"] = lead
        except Exception:
            pass

        locked = self.law.is_locked()
        if locked:
            # Shadow: synthesize with live weights (post find-out surgery) but do not paper-trade
            try:
                shadow = self.leader.synthesize(signals, regime_features)
            except Exception as e:
                logger.debug(f"shadow synthesize skip: {e}")
                shadow = {"direction": "WAIT", "confidence": 0, "summary": ""}
            try:
                self.law.record_shadow(
                    direction=shadow.get("direction") or "WAIT",
                    confidence=int(shadow.get("confidence") or 0),
                    up_pct=up_pct,
                    down_pct=down_pct,
                    ticker=ticker,
                    summary=str(shadow.get("summary") or ""),
                )
                self.law.grade_shadows(up_pct, down_pct)
            except Exception as e:
                logger.debug(f"shadow grade skip: {e}")
            sh = self.law.shadow_stats
            decision = {
                "direction": "WAIT",
                "confidence": 92,
                "summary": (
                    f"LAW lockdown · {self.law.lockdown_remaining} window · "
                    f"shadow {sh.get('right', 0)}✓/{sh.get('wrong', 0)}✗ · "
                    f"{self.law.last_lock_reason or 'repair bay'}"
                ),
                "score": 0.0,
                "diversity": 0,
                "weights": dict(self.leader.weights),
                "lockdown": True,
                "shadow_direction": shadow.get("direction"),
                "shadow_confidence": shadow.get("confidence"),
                "eth_shadow_pick": shadow.get("eth_shadow_pick"),
                "btc_shadow_pick": shadow.get("btc_shadow_pick"),
            }
            # Annotate debate UI after shadow capture
            signals = apply_find_out_to_signals(signals, self.law)
        else:
            decision = self.leader.synthesize(signals, regime_features)
            # First live call after unlock: temporary stricter Chair bar
            if self.law.consume_post_unlock_strict():
                decision["summary"] = (
                    (decision.get("summary") or "") + " · post-lock strict"
                )
                try:
                    self.leader.cool_down_bump = max(
                        float(getattr(self.leader, "cool_down_bump", 0) or 0), 0.06
                    )
                except Exception:
                    pass

        # ── Council → engine gate ─────────────────────────────────────────
        # Compute Satoshi's Round Table decision from the SAME signals and,
        # when COUNCIL_GATE_MODE == "hard", hold the trade engine back if the
        # council did not reach confluence: force WAIT and drop NEW directional
        # path legs (existing legs still cut/flip). Default "off" = advisory
        # only — the council decision is attached for measurement but trades
        # are unchanged. Wrapped so it can never break a live decision.
        try:
            from backend.config import settings as _cs
            from backend.services.round_table import council_final as _council_final
            _ctable = {
                "agents": [s.to_dict() for s in (signals or []) if hasattr(s, "to_dict")],
                "market": market_data,
                "coinglass": market_data.get("coinglass") or {},
                "health": market_data.get("health") or {},
            }
            _cf = _council_final(_ctable)
            decision["council"] = {
                "direction": _cf.get("direction"),
                "rule": _cf.get("rule"),
                "aligned": _cf.get("aligned"),
                "summary": _cf.get("summary"),
            }
            _gate = str(getattr(_cs, "COUNCIL_GATE_MODE", "off") or "off").strip().lower()
            _council_wait = str(_cf.get("direction") or "WAIT").upper() == "WAIT"
            _engine_dir = str(decision.get("direction") or "WAIT").upper()
            if _gate == "hard" and _council_wait and _engine_dir not in ("WAIT", ""):
                decision["council_gated"] = True
                decision["ungated_direction"] = decision.get("direction")
                decision["direction"] = "WAIT"
                _pf = decision.get("path_fills")
                if isinstance(_pf, list):
                    # Hold back NEW exposure; keep only legs that CLOSE positions.
                    decision["path_fills"] = [
                        f for f in _pf
                        if str((f or {}).get("fill_kind") or (f or {}).get("action") or "").lower()
                        in ("cut", "flip_close")
                    ]
        except Exception as _ge:
            try:
                logger.debug(f"council gate skipped: {_ge}")
            except Exception:
                pass

        # Lock-time strike on the paper row. Closer still uses official result,
        # not current_price vs strike.
        _lock_strike = lock_time_strike(
            ticker=ticker,
            floor_strike=market_data.get("kalshi_floor_strike"),
            cap_strike=market_data.get("kalshi_cap_strike"),
        )
        decision["kalshi_target"] = _lock_strike
        decision["floor_strike"] = _lock_strike

        # Lock quality score (0–100): confluence × odds band × spread
        try:
            conf = float(decision.get("confidence") or 0)
            up = up_pct
            lean = decision.get("direction")
            so = None
            if lean in ("UP", "DOWN") and up is not None:
                so = float(up) if lean == "UP" else (100.0 - float(up))
            band = 1.0
            if so is not None:
                if 40 <= so <= 65:
                    band = 1.0
                elif 35 <= so <= 75:
                    band = 0.85
                else:
                    band = 0.65
            spread = (regime_features or {}).get("spread_cents") if isinstance(regime_features, dict) else None
            sp = 1.0
            if spread is not None:
                sp = max(0.5, 1.0 - (float(spread) / 12.0))
            q = int(max(0, min(100, conf * band * sp)))
            decision["quality_score"] = q
            if decision.get("locked_call") and isinstance(decision["locked_call"], dict):
                decision["locked_call"]["quality_score"] = q
        except Exception:
            pass

        # Shadow book (diagnostic only): would a stricter 45–60¢ band have locked?
        # Paper playable band stays 10–90¢ + leftover — do not make 45–55 the live band.
        try:
            from backend.config import settings as _s
            so = None
            lean = decision.get("direction")
            if lean in ("UP", "DOWN") and up_pct is not None:
                so = float(up_pct) if lean == "UP" else (100.0 - float(up_pct))
            strict_lo, strict_hi = 45.0, 60.0
            in_strict = so is not None and strict_lo <= so <= strict_hi
            would = bool(
                decision.get("window_locked") or (decision.get("locked_call") or {}).get("locked")
            ) and in_strict
            self._shadow_book.append({
                "t": time.time(),
                "asset": self.asset,
                "live_dir": decision.get("direction"),
                "live_odds": so,
                "would_strict_lock": would,
                "in_strict_band": in_strict,
            })
            self._shadow_book = self._shadow_book[-80:]
        except Exception:
            pass


        signal_id = await self.store.log_signal(
            decision,
            signals,
            market_ticker=ticker,
            entry_price=entry_price,
            close_time=close_time,
            kalshi_target=lock_time_strike(
                ticker=ticker,
                floor_strike=market_data.get("kalshi_floor_strike"),
                cap_strike=market_data.get("kalshi_cap_strike"),
            ),
            up_pct=up_pct,
            down_pct=down_pct,
            asset=self.asset,
            spot=market_data.get("current_price") or market_data.get("price"),
        )
        await self._maybe_record_wait_sample(
            decision, signals, ticker, close_time, market_data, up_pct, down_pct
        )
        await self._maybe_record_eth_shadow(decision, ticker, close_time)
        await self._maybe_record_btc_shadow(decision, ticker, close_time)

        accuracy = await self.store.get_accuracy(asset=self.asset)
        # Feed lifetime edge into Chair so WAIT bar loosens as hit-rate proves out
        self.leader.update_edge_from_accuracy(accuracy)
        law_status = self.law.status()

        # Build public state for frontend
        state = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "asset": self.asset,
            "leader_name": self.leader_name,
            "decision": {
                "direction": decision["direction"],
                "confidence": decision["confidence"],
                "summary": decision["summary"],
                "score": decision.get("score"),
                "diversity": decision.get("diversity"),
                "lockdown": bool(decision.get("lockdown")),
                "lean": decision.get("lean"),  # underlying UP/DOWN when direction is SWAP/HOLD
                "call_phase": decision.get("call_phase"),
                "locked_call": decision.get("locked_call"),  # clear follower-readable lock
                "eth_shadow_pick": decision.get("eth_shadow_pick"),
                "btc_shadow_pick": decision.get("btc_shadow_pick"),
                "p_finish": decision.get("p_finish"),
                "ev_cents": decision.get("ev_cents"),
                "ev_phase": decision.get("ev_phase"),
                "quality_score": decision.get("quality_score"),
                "display_direction": (
                    "1/4 UP HOLD" if decision["direction"] == "UP_HOLD"
                    else "1/4 DOWN HOLD" if decision["direction"] == "DOWN_HOLD"
                    else decision["direction"]
                ),
                "threshold_used": decision.get("threshold_used"),
                "wait_rate": decision.get("wait_rate"),
                "learning_phase": (
                    (regime_features.get("learning_phase") if isinstance(regime_features, dict) else None)
                    or (decision.get("learning_phase") if isinstance(decision, dict) else None)
                ),
                "edge_score": decision.get("edge_score"),
                "regime_key": decision.get("regime_key") or regime_features.get("regime_key"),
                "top_agree": decision.get("top_agree"),
                "top_conflict": decision.get("top_conflict"),
            },
            "agents": [s.to_dict() for s in signals],
            "weights": decision.get("weights") or self.leader.weights,
            "market": {
                "price": market_data.get("current_price"),
                "funding": market_data.get("funding_rate"),
                "oi": market_data.get("open_interest"),
                "kalshi_ticker": ticker,
                "ticker": ticker,
                "series_ticker": market_data.get("series_ticker") or (market_data.get("kalshi") or {}).get("series_ticker"),
                "floor_strike": _lock_strike,
                "stale": bool(market_data.get("stale") or (market_data.get("kalshi") or {}).get("stale")),
                "kalshi_yes_bid": market_data.get("kalshi_yes_bid"),
                "kalshi_yes_ask": market_data.get("kalshi_yes_ask"),
                "up_pct": up_pct,
                "up_mid": up_pct,
                "down_pct": down_pct,
                "close_time": close_time,
                "mins_left": market_data.get("mins_left"),
                "window_minutes": (regime_features or {}).get("window_minutes"),
                "seconds_left": (float(market_data["mins_left"]) * 60.0) if market_data.get("mins_left") is not None else None,
                # Kalshi settlement threshold (YES if asset finishes above this)
                "kalshi_target": _lock_strike,
                "kalshi_title": market_data.get("kalshi_title"),
                # Slim candle series for right-side live chart (last ~60 × 1m)
                "candles": [
                    {
                        "t": c.get("open_time") or c.get("t"),
                        "o": c.get("open"),
                        "h": c.get("high"),
                        "l": c.get("low"),
                        "c": c.get("close"),
                        "v": c.get("volume") or c.get("v"),
                    }
                    for c in (market_data.get("candles") or [])[-60:]
                ],
            },
            "fetch_ms": market_data.get("fetch_ms"),
            "fetched_at": market_data.get("fetched_at"),
            "signal_id": signal_id,
            "mode_hint": "art",
            "analysis_interval_s": settings.ANALYSIS_INTERVAL,
            "beast_mode": runtime_settings.beast_mode,
            "system_settings": runtime_settings.snapshot(),
            "parallel_agents": bool(runtime_settings.get("parallel_agents", True)),
            "dual_spot": bool(runtime_settings.get("dual_spot", True)),
            "sub_council_count": sum(len(s.subs or []) for s in signals),
            "accuracy": accuracy,
            "locked_call": decision.get("locked_call"),
            "p_finish": decision.get("p_finish"),
            "ev_cents": decision.get("ev_cents"),
            "ev_phase": decision.get("ev_phase"),
            "shadow_book": list(self._shadow_book[-12:]),
            "last_settle_review": self._last_settle_review,
            "health": {
                **(market_data.get("health") or {}),
                "kalshi": bool((market_data.get("health") or {}).get(
                    "kalshi",
                    market_data.get("kalshi_healthy", market_data.get("healthy", True)),
                )),
                "binance": bool((market_data.get("health") or {}).get("binance", False)),
                "coinbase": bool((market_data.get("health") or {}).get("coinbase", False)),
                "coinglass": bool((market_data.get("health") or {}).get("coinglass", False)),
                "spot_source": (market_data.get("health") or {}).get("spot_source")
                    or market_data.get("spot_source"),
                "quote_age_s": (time.time() - float(market_data["kalshi_fetched_at"]))
                    if market_data.get("kalshi_fetched_at") else None,
                "from_cache": bool(market_data.get("from_shared_cache") or market_data.get("last_good")),
                "asset": self.asset,
            },
            "regime_key": (regime_features.get("regime_key") if isinstance(regime_features, dict) else None),
            "lock_timeline": {
                "close_time": close_time,
                "locked_at": getattr(self.leader, "_entry_at", None) or getattr(self.leader, "_locked_at", None),
                "mins_left": (regime_features.get("mins_left") if isinstance(regime_features, dict) else None),
            },

            "law": law_status,
            "learning": self.learner.snapshot(),
            "hierarchy": self.learner.hierarchy_ranks(),
            "regime": (
                self.learner.regime_snapshot(regime_features.get("regime_key"))
                if hasattr(self.learner, "regime_snapshot") else {}
            ),
            "huddle": self.huddle.status(),
            "color_counts": color_counts_from_signals(signals),
            "quorum": (self.learner.quorum_snapshot() if hasattr(self.learner, "quorum_snapshot") else {}),
        }
        self.latest_state = state
        logger.info(
            f"[{self.asset}/{self.leader_name}] Council: {decision['direction']} "
            f"({decision['confidence']}%) – {decision['summary']} "
            f"[subs={state['sub_council_count']}] "
            f"acc={accuracy.get('label')} law_lock={law_status.get('lockdown_remaining')}"
        )
        return state

    async def _maybe_record_wait_sample(
        self,
        decision: Dict[str, Any],
        signals: List[Any],
        ticker: str | None,
        close_time: str | None,
        market_data: Dict[str, Any],
        up_pct: float | None,
        down_pct: float | None,
    ) -> None:
        """Write a WAIT sample for this hour when nobody locked. Learning ≠ locking more."""
        locked = bool(
            decision.get("window_locked")
            or (
                isinstance(decision.get("locked_call"), dict)
                and decision["locked_call"].get("locked")
            )
        )
        direction = str(decision.get("direction") or "WAIT").upper()
        prev = getattr(self, "_wait_snapshot", None)
        if (
            prev
            and prev.get("ticker")
            and not prev.get("locked")
            and (
                (ticker and prev.get("ticker") != ticker)
                or (close_time and prev.get("close_time") and prev.get("close_time") != close_time)
            )
        ):
            try:
                await self.store.record_wait_sample(
                    ticker=prev["ticker"],
                    close_time=prev.get("close_time"),
                    wait_reason=prev.get("wait_reason"),
                    seat_split=prev.get("seat_split"),
                    book_depth=prev.get("book_depth"),
                    would_lock_if_strict=bool(prev.get("would_lock_if_strict")),
                    asset=self.asset,
                    confidence=int(prev.get("confidence") or 0),
                    regime_key=prev.get("regime_key"),
                    up_pct=prev.get("up_pct"),
                    down_pct=prev.get("down_pct"),
                )
            except Exception as e:
                logger.debug(f"WAIT flush skip: {e}")
        if locked and (
            direction in (
                "UP", "DOWN", "UP_HOLD", "DOWN_HOLD",
                "BOTH", "LONG_UP", "LONG_DOWN", "SWAP",
            )
            or bool(decision.get("path_book"))
        ):
            self._wait_snapshot = {"ticker": ticker, "close_time": close_time, "locked": True}
            return
        tick = ticker or (f"WAIT-{self.asset}-{(close_time or '')[:16]}" if close_time else None)
        if not tick:
            return
        reason = classify_wait_reason(decision.get("summary"), decision, market_data)
        seat_split = {
            "UP": sum(1 for s in signals if getattr(s, "direction", None) == "UP"),
            "DOWN": sum(1 for s in signals if getattr(s, "direction", None) == "DOWN"),
            "WAIT": sum(1 for s in signals if getattr(s, "direction", None) == "WAIT"),
            "total": len(signals),
        }
        raw_depth = None
        if isinstance(market_data, dict):
            raw_depth = (
                market_data.get("book_depth")
                or market_data.get("kalshi_orderbook")
                or market_data.get("orderbook")
            )
            rf = market_data.get("regime") if isinstance(market_data.get("regime"), dict) else None
            if raw_depth is None and rf:
                raw_depth = rf.get("book_depth") or rf.get("kalshi_orderbook")
        depth = raw_depth if isinstance(raw_depth, dict) and "yes_depth" in raw_depth else parse_book_depth(raw_depth)
        so = None
        lean = decision.get("lean")
        try:
            if lean in ("UP", "DOWN") and up_pct is not None:
                so = float(up_pct) if lean == "UP" else (100.0 - float(up_pct))
        except (TypeError, ValueError):
            so = None
        would = bool(so is not None and 45.0 <= so <= 60.0 and lean in ("UP", "DOWN"))
        snap = {
            "ticker": tick,
            "close_time": close_time,
            "wait_reason": reason,
            "seat_split": seat_split,
            "book_depth": depth,
            "would_lock_if_strict": would,
            "asset": self.asset,
            "confidence": int(decision.get("confidence") or 0),
            "regime_key": decision.get("regime_key"),
            "up_pct": up_pct,
            "down_pct": down_pct,
            "locked": False,
        }
        self._wait_snapshot = snap
        try:
            created = await self.store.record_wait_sample(
                ticker=tick,
                close_time=close_time,
                wait_reason=reason,
                seat_split=seat_split,
                book_depth=depth,
                would_lock_if_strict=would,
                asset=self.asset,
                confidence=int(decision.get("confidence") or 0),
                regime_key=decision.get("regime_key"),
                up_pct=up_pct,
                down_pct=down_pct,
            )
        except Exception as e:
            logger.debug(f"WAIT sample skip: {e}")
            return
        if created:
            try:
                self.learner.learn_from_wait(
                    agent_votes={s.agent_name: s.to_dict() for s in signals if hasattr(s, "to_dict")},
                    outcome=None,
                    wait_reason=reason,
                    would_lock_if_strict=would,
                    regime=decision.get("regime_key"),
                    count_wait=True,
                )
                self.learner.save()
            except Exception as e:
                logger.debug(f"WAIT learn skip: {e}")

    def _rank_leaders_from_row(self, row, votes, *, satoshi, correct) -> None:
        """
        Advance the Round Table standings from one settled row.

        The four movable leaders are re-scored on what their own seats said
        at call time, replayed from the persisted agent votes. Satoshi is
        never scored — he is rank 0 and immovable. BTC only, so a dual-table
        deployment does not double-count a single decision.
        """
        if self.asset != "btc":
            return
        try:
            from backend.learning.leader_ranks import rank_book
            from backend.services.round_table import leans_from_votes

            leans = leans_from_votes(votes)
            if not any(v is not None for v in leans.values()):
                return
            rank_book().record_settled(
                leans=leans, satoshi=satoshi, correct=correct, ref=row.get("id"),
            )
        except Exception as e:
            logger.debug(f"leader rank update skip: {e}")

    async def _learn_from_new_settlements(self, *, limit: int = 40, max_learn: int = 5) -> int:
        """
        Grade agent votes on any settled windows we haven't learned from yet.
        Drives continuous weight drift + pair affinity.
        Tape backfill passes a high limit so weeks of NULL hours can train.
        """
        recent = await self.store.recent_settled_calls(limit=limit, asset=self.asset)
        learned = 0
        wait_learned = 0
        FINISH = {"finish_match", "finish_miss"}
        path_buf = []
        for row in reversed(recent):  # chronological
            rid = row.get("id")
            if rid is None or rid in self._last_learned_ids:
                continue
            settle_reason = row.get("settle_reason") or ""
            direction = str(row.get("direction") or "").upper()
            outcome = row.get("y_finish") or row.get("actual_outcome") or row.get("outcome")
            votes = row.get("agent_votes") or {}
            try:
                from backend.learning.btc15m import is_btc_15m_ticker
                from backend.learning.btc15m_path import is_path_settle_reason
                if is_btc_15m_ticker(row.get("ticker")):
                    if is_path_settle_reason(settle_reason):
                        # Path-managed legs still learn on realised P&L.
                        path_buf.append(row)
                        self._last_learned_ids.add(rid)
                        continue
                    # finish_match / finish_miss on BTC 15m now FALL THROUGH to
                    # the finish-direction learner below, so the seats learn
                    # whether they called the move (up/down) before it happened —
                    # the goal — instead of only path P&L. Everything else on the
                    # BTC book (WAIT shadow, unresolved) is left as before.
                    if settle_reason not in FINISH:
                        self._last_learned_ids.add(rid)
                        continue
            except Exception:
                pass
            # BTC WAIT shadow is a parallel paper bin — do not train Chair lock weights from it.
            if is_btc_shadow_row(row):
                self._last_learned_ids.add(rid)
                continue
            if direction == "WAIT" or settle_reason == "wait_finish":
                y = row.get("y_finish")
                if y not in ("UP", "DOWN"):
                    y = None
                reg = row.get("regime") or row.get("regime_key")
                if not reg:
                    reg = regime_from_call(row.get("called_at"), row.get("close_time"))
                self.learner.learn_from_wait(
                    agent_votes=votes,
                    outcome=y,
                    wait_reason=row.get("wait_reason"),
                    would_lock_if_strict=bool(row.get("would_lock_if_strict")),
                    regime=reg,
                    count_wait=False,
                )
                wait_learned += 1
                self._rank_leaders_from_row(row, votes, satoshi="WAIT", correct=None)
                self._last_learned_ids.add(rid)
                if (learned + wait_learned) >= int(max_learn):
                    break
                continue
            # Never train on VOID / path-era / unresolved
            if outcome in ("VOID", None, "") or settle_reason not in FINISH:
                self._last_learned_ids.add(rid)
                continue
            if outcome in ("UP", "DOWN"):
                reg = row.get("regime") or row.get("regime_key")
                if not reg:
                    reg = regime_from_call(row.get("called_at"), row.get("close_time"))
                self.learner.learn_from_settled(votes, outcome, regime=reg, credit=1.0)
                if hasattr(self.learner, "record_finish_calibration"):
                    try:
                        pred = row.get("p_finish")
                        if pred is None and row.get("confidence") is not None:
                            pred = float(row.get("confidence") or 0) / 100.0
                        self.learner.record_finish_calibration(
                            side_odds=row.get("open_price") or row.get("entry_side_pct"),
                            p_finish=pred,
                            finished=bool(row.get("correct") == 1),
                            pnl=row.get("paper_pnl"),
                        )
                    except Exception:
                        pass
                learned += 1
                self._rank_leaders_from_row(
                    row, votes, satoshi=direction, correct=(outcome == direction),
                )
            self._last_learned_ids.add(rid)
            if learned >= int(max_learn):
                break
        if path_buf and hasattr(self.learner, "learn_from_path_pnl"):
            grouped: Dict[tuple, list] = {}
            for row in path_buf:
                key = (str(row.get("ticker") or ""), str(row.get("close_time") or ""))
                grouped.setdefault(key, []).append(row)
            for legs in grouped.values():
                net = 0.0
                votes: Dict[str, Any] = {}
                held = set()
                reg = None
                for leg in legs:
                    try:
                        net += float(leg.get("paper_pnl") or 0.0)
                    except (TypeError, ValueError):
                        pass
                    votes.update(leg.get("agent_votes") or {})
                    d = str(leg.get("direction") or "").upper()
                    if d in ("UP", "DOWN"):
                        held.add(d)
                    reg = reg or leg.get("regime") or leg.get("regime_key")
                cut = set()
                try:
                    from backend.learning.btc15m_path import cut_sides_from_path_legs
                    cut = cut_sides_from_path_legs(legs)
                except Exception:
                    cut = set()
                if votes:
                    self.learner.learn_from_path_pnl(
                        votes, net, held, regime=reg, count_as_lock=False, cut_sides=cut
                    )
                    learned += 1
        # Bound memory of learned ids
        if len(self._last_learned_ids) > 500:
            keep = set(sorted(self._last_learned_ids)[-300:])
            self._last_learned_ids = keep
        if learned or wait_learned:
            self.leader.sync_from_learner()
            # Persist brain so longer runs survive restarts
            try:
                self.learner.save()
            except Exception as e:
                logger.debug(f"learner save skip: {e}")
            # Persist weight changes for audit
            snap = self.learner.snapshot()
            for name, rec in (snap.get("records") or {}).items():
                try:
                    await self.store.log_weight_change(
                        name,
                        settings.BASE_WEIGHTS.get(name, 0.1),
                        rec.get("weight") or 0.1,
                        "adaptive continuous",
                    )
                except Exception:
                    pass
            phase = (snap.get("learning_phase") or {}).get("phase")
            logger.info(
                f"Adaptive: learned from {learned} settlement(s) · phase={phase or '?'} · "
                f"updates={snap.get('updates')}"
            )
        return learned

    def _wait_agent_shell(self, reason: str = "warming") -> list:
        """WAIT stubs so /api/state never ships agents: [] while the loop is up."""
        from backend.agents.base import AgentSignal
        out = []
        for a in self.agents or []:
            name = getattr(a, "name", None) or getattr(a, "agent_name", None)
            if not name:
                continue
            cat = getattr(a, "category", None) or name
            sig = AgentSignal(name, "WAIT", 0, reason, cat)
            out.append(sig.to_dict())
        return out

    def _empty_state(self, reason: str = "Initializing...") -> Dict[str, Any]:
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "asset": self.asset,
            "leader_name": self.leader_name,
            "decision": {
                "direction": "WAIT",
                "confidence": 50,
                "summary": reason,
                "locked_call": None,
                "p_finish": None,
                "ev_cents": None,
            },
            "agents": self._wait_agent_shell(reason),
            "weights": self.leader.weights,
            "market": {},
            "health": {},
            "sub_council_count": 0,
            "hydrating": True,
            "accuracy": {
                "correct": 0,
                "total": 0,
                "wrong": 0,
                "accuracy_pct": None,
                "pending": 0,
                "streak": 0,
                "wrong_streak": 0,
                "label": "0/0 · —",
                "hydrating": True,
            },
            "locked_call": None,
            "p_finish": None,
            "ev_cents": None,
            "law": self.law.status(),
            "learning": self.learner.snapshot(),
            "hierarchy": self.learner.hierarchy_ranks(),
        }

    def ensure_seat_shell(self, reason: str = "warming") -> Dict[str, Any]:
        """If the loop hung before analyze_once painted seats, keep WAIT chairs."""
        live = self.latest_state if isinstance(self.latest_state, dict) else {}
        agents = live.get("agents") if isinstance(live.get("agents"), list) else []
        if agents:
            return live
        seed = self._empty_state(reason)
        for k in ("accuracy", "huddle", "law", "learning", "hierarchy", "weights", "market", "health"):
            if live.get(k):
                seed[k] = live[k]
        if live.get("decision"):
            seed["decision"] = live["decision"]
        seed["agents"] = self._wait_agent_shell(reason)
        seed["timestamp"] = datetime.now(timezone.utc).isoformat()
        self.latest_state = seed
        return seed

    async def hydrate_persisted_desk(self) -> Dict[str, Any]:
        """Read lifetime log + huddle from disk into latest_state.

        Used after deploy / process start so /api/state is not an empty
        'Initializing… 50%' shell. Never deletes council.db, brain, or
        learning JSON — analyze_once also only reads get_accuracy.
        """
        acc = None
        try:
            acc = await self.store.get_accuracy(asset=self.asset)
            if isinstance(acc, dict):
                acc = dict(acc)
                acc["hydrating"] = False
                acc["hydrated"] = True
        except Exception as e:
            logger.debug(f"accuracy hydrate skip ({self.asset}): {e}")
            acc = None
        huddle = None
        try:
            huddle = self.huddle.status()
        except Exception:
            huddle = None
        live = self.latest_state or {}
        if live and (live.get("accuracy") or {}).get("hydrated"):
            # Keep a live analyze_once payload; only fill missing huddle.
            if huddle and not live.get("huddle"):
                live = dict(live)
                live["huddle"] = huddle
                self.latest_state = live
            if not (live.get("agents") or []):
                return self.ensure_seat_shell("hydrating")
            return live
        seed = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "decision": {
                "direction": "WAIT",
                "confidence": 50,
                "summary": "Initializing...",
                "locked_call": None,
                "p_finish": None,
                "ev_cents": None,
            },
            "agents": live.get("agents") or self._wait_agent_shell("hydrating"),
            "weights": self.leader.weights,
            "market": live.get("market") or {},
            "health": live.get("health") or {},
            "sub_council_count": live.get("sub_council_count") or 0,
            "accuracy": acc if acc is not None else {
                "correct": 0,
                "total": 0,
                "wrong": 0,
                "accuracy_pct": None,
                "pending": 0,
                "streak": 0,
                "wrong_streak": 0,
                "label": "0/0 · —",
                "hydrating": True,
            },
            "hydrating": acc is None,
            "locked_call": live.get("locked_call"),
            "p_finish": live.get("p_finish"),
            "ev_cents": live.get("ev_cents"),
            "law": self.law.status(),
            "learning": self.learner.snapshot(),
            "hierarchy": self.learner.hierarchy_ranks(),
            "huddle": huddle or live.get("huddle") or {},
        }
        self.latest_state = seed
        logger.info(
            f"[{self.asset}] Desk hydrated from disk "
            f"hits={((acc or {}).get('total') if acc else 0)} "
            f"(no storage reset)"
        )
        return seed

    def get_state(self) -> Dict[str, Any]:
        # Cold-start safe: never reference undefined names in the fallback.
        # Empty accuracy here is hydrating — not a disk wipe. No log/open
        # arrays so the UI will not paint LIFETIME LOG EMPTY over a reload.
        if self.latest_state:
            st = self.latest_state
            agents = st.get("agents") if isinstance(st.get("agents"), list) else []
            if not agents:
                return self.ensure_seat_shell("hydrating")
            return st
        return self._empty_state("Initializing...")

    async def maybe_reweight(self):
        """Periodic snapshot of agent stats (adaptive learner runs continuously)."""
        try:
            stats = await self.store.update_agent_stats()
            if stats:
                logger.info(f"Agent performance snapshot: {stats}")
        except Exception as e:
            logger.debug(f"Reweight skip: {e}")
