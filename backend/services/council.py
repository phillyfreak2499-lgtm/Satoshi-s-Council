"""
Council orchestrator – wires pipeline, agents, leader, store, and continuous loop.
Includes nested sub-council micro-bots behind each specialist.
"""
from __future__ import annotations
import asyncio
from typing import Any, Dict, List
from datetime import datetime, timezone
from loguru import logger

from backend.data.pipeline import DataPipeline
from backend.agents.candle import CandlePatternSpecialist
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
        self.learner = AdaptiveLearner()
        self.leader = Leader(learner=self.learner)
        self.wm = WindowMemory()
        self.law = LawBot()
        self.agents = [
            CandlePatternSpecialist(),
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
        self.latest_state: Dict[str, Any] = {}
        self._task: asyncio.Task | None = None
        self.running = False
        self._last_learned_ids: set = set()
        self.huddle = NightlyHuddle()

    async def start(self):
        await self.store.init()
        # Seed multi-window memory from recent settled calls
        try:
            rows = []
            if hasattr(self.store, "recent_settled_calls"):
                rows = await self.store.recent_settled_calls(24)
            elif hasattr(self.store, "get_recent_settled"):
                rows = await self.store.get_recent_settled(24)
            if rows:
                n = self.wm.seed_from_store(rows)
                logger.info(f"WindowMemory seeded with {n} settled windows")
        except Exception as e:
            logger.debug(f"WindowMemory seed: {e}")
        # Rebuild adaptive weights + pair affinities from history
        try:
            try:
                self.learner.load()
            except Exception:
                pass
            n = await self.learner.rebuild_from_store(self.store)
            self.leader.sync_from_learner()
            logger.info(f"Adaptive weights restored from {n} windows")
        except Exception as e:
            logger.debug(f"Adaptive rebuild: {e}")
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
                    interval = float(getattr(settings, "ANALYSIS_INTERVAL_ETH", 4.0))
                elif self.asset == "btc":
                    interval = float(getattr(settings, "ANALYSIS_INTERVAL_BTC", 4.0))
                else:
                    interval = float(prof.get("analysis_interval", getattr(settings, "ANALYSIS_INTERVAL", 4.0)))
                st = self.latest_state or {}
                mkt = st.get("market") or {}
                dec = (st.get("decision") or {}).get("direction")
                hot = dec in ("UP", "DOWN", "UP_HOLD", "DOWN_HOLD", "SWAP")
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

    async def analyze_once(self) -> Dict[str, Any]:
        # Refresh edge stats before synthesis so WAIT bar tracks lifetime log
        try:
            self.leader.update_edge_from_accuracy(await self.store.get_accuracy(asset=self.asset))
        except Exception:
            pass

        # Nightly 3:00–3:15 AM CT huddle (one 15m cool-down + learning consolidate)
        try:
            await self.huddle.maybe_run(self.store, self.learner, self.leader, law=self.law)
            self.leader.cool_down_bump = float(self.huddle.cool_down_bump())
        except Exception as e:
            self.leader.cool_down_bump = 0.0
            logger.debug(f"Huddle cycle: {e}")

        market_data = await self.pipeline.fetch()
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
            self.wm.on_tick(ticker, up_pct, price, mins_left)
            # Reflect Chair entry if already locked this window
            if getattr(self.leader, "_entry_dir", None) and not self.wm.live.entry_dir:
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
        entry_price = market_data.get("current_price")

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
        try:
            await self.store.settle_expired_calls(
                current_price=entry_price,
                up_pct=up_pct,
                down_pct=down_pct,
                floor_strike=market_data.get("kalshi_floor_strike"),
                asset=self.asset,
            )
            try:
                from datetime import datetime, timezone
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

        # Teach the learner from any newly settled windows
        try:
            await self._learn_from_new_settlements()
        except Exception as e:
            logger.debug(f"Adaptive learn skip: {e}")

        # LAW evaluates streak / may trigger lockdown + find-out fixes
        try:
            await self.law.evaluate_after_settle(self.store, self.leader, self.agents)
            self.leader.sync_from_learner()
        except Exception as e:
            logger.debug(f"LAW evaluate skip: {e}")

        # Consume a lockdown slot once per distinct window
        if self.law.is_locked():
            self.law.note_window(ticker)

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
                subs = subs_map.get(agent.name, [])
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

        # QUORUM second pass: sees peer colors + historical size/combo stats
        if quorum_agent is not None:
            try:
                if hasattr(quorum_agent, "bind_learner"):
                    quorum_agent.bind_learner(self.learner)
                peer_dirs = {s.agent_name: s.direction for s in signals}
                qsig = quorum_agent.from_peers(peer_dirs, market_data)
                signals.append(qsig)
            except Exception as e:
                logger.error(f"Quorum agent failed: {e}")
                from backend.agents.base import AgentSignal
                signals.append(AgentSignal("quorum", "WAIT", 0, f"Error: {e}", "quorum", muted=True))

        # Guardian updates
        guardian = next((a for a in self.agents if a.name == "guardian"), None)
        if guardian and isinstance(guardian, GuardianBot):
            guardian.update_health(market_data.get("health", {}), signals)

        # Regime features for Leader
        # (find-out annotation applied after shadow capture when locked)
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
                regime_features["floor_strike"] = market_data.get("kalshi_floor_strike")
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
            # Bid-ask spread in cents for Chair gate
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

        # Attach Kalshi target so settlement grades against floor_strike
        decision["kalshi_target"] = market_data.get("kalshi_floor_strike")

        signal_id = await self.store.log_signal(
            decision,
            signals,
            market_ticker=ticker,
            entry_price=entry_price,
            close_time=close_time,
            kalshi_target=market_data.get("kalshi_floor_strike"),
            up_pct=up_pct,
            down_pct=down_pct,
        )

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
                "display_direction": (
                    "1/4 UP HOLD" if decision["direction"] == "UP_HOLD"
                    else "1/4 DOWN HOLD" if decision["direction"] == "DOWN_HOLD"
                    else decision["direction"]
                ),
                "threshold_used": decision.get("threshold_used"),
                "wait_rate": decision.get("wait_rate"),
                "learning_phase": (decision.get("threshold_base") is not None and ("cold" if (self.leader.edge.get("total") or 0) < int(getattr(settings, "COLD_START_SAMPLES", 15)) else "learned")),
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
                "floor_strike": market_data.get("kalshi_floor_strike"),
                "stale": bool(market_data.get("stale") or (market_data.get("kalshi") or {}).get("stale")),
                "kalshi_yes_bid": market_data.get("kalshi_yes_bid"),
                "kalshi_yes_ask": market_data.get("kalshi_yes_ask"),
                "up_pct": up_pct,
                "up_mid": up_pct,
                "down_pct": down_pct,
                "close_time": close_time,
                "mins_left": market_data.get("mins_left"),
                "seconds_left": (float(market_data["mins_left"]) * 60.0) if market_data.get("mins_left") is not None else None,
                # Kalshi settlement threshold (YES if asset finishes above this)
                "kalshi_target": market_data.get("kalshi_floor_strike"),
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
            "health": market_data.get("health"),
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
            "law": law_status,
            "learning": self.learner.snapshot(),
            "hierarchy": self.learner.hierarchy_ranks(),
            "regime": (
                self.learner.regime_snapshot(regime_features.get("regime_key"))
                if hasattr(self.learner, "regime_snapshot") else {}
            ),
            "huddle": self.huddle.status(),
            "color_counts": {
                "UP": sum(1 for s in signals if s.direction == "UP"),
                "DOWN": sum(1 for s in signals if s.direction == "DOWN"),
                "WAIT": sum(1 for s in signals if s.direction == "WAIT"),
                "total": len(signals),
            },
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

    async def _learn_from_new_settlements(self) -> int:
        """
        Grade agent votes on any settled windows we haven't learned from yet.
        Drives continuous weight drift + pair affinity.
        """
        recent = await self.store.recent_settled_calls(limit=40)
        learned = 0
        for row in reversed(recent):  # chronological
            rid = row.get("id")
            if rid is None or rid in self._last_learned_ids:
                continue
            outcome = row.get("outcome")
            votes = row.get("agent_votes") or {}
            if outcome in ("UP", "DOWN") and votes:
                reg = row.get("regime") or row.get("regime_key")
                if not reg:
                    reg = regime_from_call(row.get("called_at"), row.get("close_time"))
                # Reduced learning credit for near_certain freebies (entry already extreme)
                credit = 1.0
                settle_reason = row.get("settle_reason") or ""
                open_px = row.get("open_price")
                near_bar = float(getattr(settings, "NEAR_CERTAIN_ENTRY_BAR", 88.0))
                near_credit = float(getattr(settings, "NEAR_CERTAIN_LEARN_CREDIT", 0.25))
                try:
                    if settle_reason == "near_certain" and open_px is not None and float(open_px) >= near_bar:
                        credit = near_credit
                except Exception:
                    pass
                self.learner.learn_from_settled(votes, outcome, regime=reg, credit=credit)
                learned += 1
            self._last_learned_ids.add(rid)
        # Bound memory of learned ids
        if len(self._last_learned_ids) > 500:
            keep = set(sorted(self._last_learned_ids)[-300:])
            self._last_learned_ids = keep
        if learned:
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

    def get_state(self) -> Dict[str, Any]:
        # Cold-start safe: never reference undefined names in the fallback.
        base = self.latest_state or {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "decision": {
                "direction": "WAIT",
                "confidence": 50,
                "summary": "Initializing...",
                "locked_call": None,
            },
            "agents": [],
            "weights": self.leader.weights,
            "market": {},
            "health": {},
            "sub_council_count": 0,
            "accuracy": {
                "correct": 0,
                "total": 0,
                "wrong": 0,
                "accuracy_pct": None,
                "pending": 0,
                "streak": 0,
                "wrong_streak": 0,
                "label": "0/0 · —",
            },
            "locked_call": None,
            "law": self.law.status(),
            "learning": self.learner.snapshot(),
            "hierarchy": self.learner.hierarchy_ranks(),
        }
        return base

    async def maybe_reweight(self):
        """Periodic snapshot of agent stats (adaptive learner runs continuously)."""
        try:
            stats = await self.store.update_agent_stats()
            if stats:
                logger.info(f"Agent performance snapshot: {stats}")
        except Exception as e:
            logger.debug(f"Reweight skip: {e}")
