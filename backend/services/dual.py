"""
Dual-table orchestrator: Bitcoin (Satoshi) + Ethereum (Vitalik).
Sequential analysis on a shared event loop for ~2 CPU / 4 GB hosts.
Proxies store/leader/learner/huddle/law to BTC so existing main.py routes keep working.
"""
from __future__ import annotations
import asyncio
from typing import Any, Dict, Optional
from loguru import logger
from backend.config import settings
from backend.services.council import Council
from backend.agents.chair_gates import build_btc_lead, floor_scorecard

DUAL_FLOOR_S = 2.0
BEAST_FLOOR_S = 1.2
ANALYZE_TIMEOUT_S = 15.0


def compute_dual_interval(
    *,
    beast: bool = False,
    active: bool = False,
    profile: Dict[str, Any] | None = None,
    adaptive: bool = True,
) -> float:
    """Shared dual cadence. Normal floor 2s; BEAST can run at 1.2s."""
    prof = profile or {}
    base = float(prof.get("analysis_interval") or getattr(settings, "ANALYSIS_INTERVAL", 2.0))
    hot = float(prof.get("analysis_interval_hot") or getattr(settings, "ANALYSIS_INTERVAL_HOT", 1.5))
    flat = float(prof.get("analysis_interval_flat") or getattr(settings, "ANALYSIS_INTERVAL_FLAT", 3.5))
    floor = BEAST_FLOOR_S if beast else DUAL_FLOOR_S
    interval = max(base, floor)
    if adaptive:
        if active:
            interval = max(hot, floor)
        else:
            interval = max(interval, flat)
    if beast:
        interval = max(BEAST_FLOOR_S, interval * 0.9)
    return interval


class DualOrchestrator:
    def __init__(self):
        self.btc = Council(asset="btc", leader_name="satoshi")
        self.eth: Optional[Council] = None
        if getattr(settings, "ENABLE_ETH_TABLE", True):
            self.eth = Council(asset="eth", leader_name="vitalik")
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self._backfill_task: Optional[asyncio.Task] = None
        # One analysis pass at a time. The background loop and a forced
        # POST /api/analyze share the same store and latest_state; letting
        # them interleave races the lock/settle path.
        self._analyze_lock = asyncio.Lock()

    # ── back-compat proxies (main.py still uses council.store / .leader / …) ──
    @property
    def store(self):
        return self.btc.store

    @property
    def leader(self):
        return self.btc.leader

    @property
    def learner(self):
        return self.btc.learner

    @property
    def huddle(self):
        return self.btc.huddle

    @property
    def law(self):
        return self.btc.law

    @property
    def pipeline(self):
        return self.btc.pipeline

    @property
    def agents(self):
        return self.btc.agents

    @property
    def latest_state(self):
        return self.get_state()

    async def start(self):
        await self.btc.store.init()
        if self.eth:
            # Separate logical table; same DB file for now (accuracy still mostly BTC-scoped via UI focus)
            await self.eth.store.init()
        # Boot-time disk recovery: the signals table only prunes in the nightly
        # huddle, so a long-bloated DB gets its space back on deploy too.
        try:
            pruned = await self.btc.store.prune_old_signals()
            if pruned:
                logger.info(f"Boot prune: removed {pruned} old signal rows")
        except Exception as e:
            logger.debug(f"boot signal prune skip: {e}")
        try:
            await self.btc.store.ensure_eth_display_reset()
        except Exception as e:
            logger.debug(f"ETH display reset skip: {e}")
        try:
            await self.btc.store.ensure_btc_15m_display_reset()
        except Exception as e:
            logger.debug(f"BTC 15m display reset skip: {e}")
        for c in self._councils():
            try:
                if hasattr(c.learner, "load"):
                    c.learner.load()
            except Exception as e:
                logger.debug(f"learner load {c.asset}: {e}")
            try:
                await c.hydrate_persisted_desk()
            except Exception as e:
                logger.debug(f"desk hydrate {c.asset}: {e}")
            try:
                c.ensure_seat_shell("warming")
            except Exception as e:
                logger.debug(f"seat shell {c.asset}: {e}")
        # Sweep after both tables are painted. The official-finish pass is
        # the ~90s wait; last-good seats+price should already be on /api/state.
        for c in self._councils():
            try:
                n = await c.sweep_official_finishes()
                if n:
                    logger.info(f"[{c.asset}] Official closer swept {n} open hour(s)")
            except Exception as e:
                logger.debug(f"official closer sweep skip ({c.asset}): {e}")
            c.running = True
        self.running = True
        self._task = asyncio.create_task(self._loop())
        try:
            from backend.learning.seat_backfill import maybe_run_boot_backfill
            from backend.learning.seat_backfill_15m import maybe_run_boot_backfill_15m

            async def _boot_backfills():
                await maybe_run_boot_backfill(self)
                await maybe_run_boot_backfill_15m(self)

            self._backfill_task = asyncio.create_task(_boot_backfills(), name="seat-backfill")
        except Exception as e:
            logger.debug(f"seat backfill boot schedule skip: {e}")
        logger.info(
            f"DualOrchestrator started (btc=on eth={'on' if self.eth else 'off'} "
            f"sequential={getattr(settings, 'DUAL_SEQUENTIAL', True)})"
        )

    def _councils(self):
        out = [self.btc]
        if self.eth:
            out.append(self.eth)
        return out

    async def stop(self):
        self.running = False
        for c in self._councils():
            c.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._backfill_task:
            self._backfill_task.cancel()
            try:
                await self._backfill_task
            except asyncio.CancelledError:
                pass
        for c in self._councils():
            try:
                await c.pipeline.close()
            except Exception:
                pass
            try:
                await c.store.close()
            except Exception:
                pass


    def snapshot_btc_lead(self) -> Dict[str, Any]:
        """Satoshi lock / lean / hour spot delta for Vitalik."""
        st = self.btc.latest_state or {}
        d = st.get("decision") or {}
        lc = d.get("locked_call") or st.get("locked_call") or {}
        raw_dir = lc.get("direction") or d.get("lean") or d.get("direction") or "WAIT"
        locked = bool(lc.get("locked") or d.get("window_locked"))
        market = st.get("market") or {}
        return build_btc_lead(
            direction=raw_dir,
            locked=locked,
            candles=market.get("candles") or [],
            price=market.get("price"),
            impulse_pct=float(getattr(settings, "BTC_LEAD_IMPULSE_PCT", 0.15)),
            strong_pct=float(getattr(settings, "BTC_LEAD_STRONG_PCT", 0.25)),
        )

    def _feed_btc_lead(self) -> None:
        if not self.eth:
            return
        try:
            self.eth.attach_btc_lead(self.snapshot_btc_lead())
        except Exception as e:
            logger.debug(f"btc-lead inject skip: {e}")

    def _correlation_veto(self) -> None:
        """If both tables lean the same side weakly, demote the weaker to WAIT (no lock yet)."""
        from backend.config import settings
        if not getattr(settings, "DUAL_CORRELATION_VETO", True):
            return
        if not self.eth:
            return
        b = (self.btc.latest_state or {}).get("decision") or {}
        e = (self.eth.latest_state or {}).get("decision") or {}
        bd = (b.get("direction") or "").upper()
        ed = (e.get("direction") or "").upper()
        # Only veto pre-lock leans / directional not yet irreversible
        bl = (b.get("locked_call") or {}).get("locked") or b.get("window_locked")
        el = (e.get("locked_call") or {}).get("locked") or e.get("window_locked")
        if bl or el:
            return
        sides = {bd, ed}
        if "UP" not in sides and "DOWN" not in sides:
            return
        if bd not in ("UP", "DOWN") or ed not in ("UP", "DOWN"):
            return
        if bd != ed:
            return
        bc = int(b.get("confidence") or 0)
        ec = int(e.get("confidence") or 0)
        # Demote weaker confidence table's displayed decision note
        weaker = self.eth if ec <= bc else self.btc
        st = weaker.latest_state or {}
        d = dict(st.get("decision") or {})
        if d.get("window_locked"):
            return
        d["direction"] = "WAIT"
        d["summary"] = (
            f"WAIT · dual correlation veto — both tables leaned {bd}; "
            f"weaker table stands down · " + str(d.get("summary") or "")
        )
        d["correlation_veto"] = True
        st["decision"] = d
        weaker.latest_state = st
        logger.info(f"Correlation veto: demoted {weaker.asset} ({bd} weak dual lean)")

    def _tables_active(self) -> bool:
        for c in self._councils():
            st = c.latest_state or {}
            d = st.get("decision") or {}
            lc = d.get("locked_call") or st.get("locked_call") or {}
            ml = (st.get("lock_timeline") or {}).get("mins_left")
            dir_ = (d.get("direction") or "WAIT").upper()
            if lc.get("locked") or dir_ in ("UP", "DOWN") or (d.get("summary") or "").startswith("LEAN"):
                return True
            if ml is not None and float(ml) <= 20:
                return True
        return False

    async def _loop(self):
        import random
        from backend.services.runtime_settings import runtime_settings
        while self.running:
            t0 = asyncio.get_event_loop().time()
            councils = self._councils()
            # Same lock a forced POST /api/analyze takes, so the two paths
            # never run a pass concurrently on the same store.
            async with self._analyze_lock:
                for i, c in enumerate(councils):
                    if not self.running:
                        break
                    try:
                        await asyncio.wait_for(c.analyze_once(), timeout=ANALYZE_TIMEOUT_S)
                    except asyncio.TimeoutError:
                        logger.warning(
                            f"Dual analysis hung ({c.asset}) after {ANALYZE_TIMEOUT_S:.0f}s — keeping seat shell"
                        )
                        try:
                            c.ensure_seat_shell("cycle timed out")
                        except Exception:
                            pass
                    except Exception as e:
                        name = type(e).__name__
                        if name in ("HTTPStatusError", "TimeoutException", "ConnectError", "ReadTimeout", "RuntimeError"):
                            logger.warning(f"Dual analysis flap ({c.asset}): {name} — desk stays up")
                        else:
                            logger.warning(f"Dual analysis error ({c.asset}): {name}: {e}")
                        try:
                            c.ensure_seat_shell("cycle error")
                        except Exception:
                            pass
                        try:
                            await c.settle_due_windows()
                        except Exception as se:
                            logger.debug(f"Dual settle-after-error skip ({c.asset}): {se}")
                    if c.asset == "btc":
                        self._feed_btc_lead()
                    # Jitter between tables so Kalshi calls don't stampede
                    if i < len(councils) - 1:
                        try:
                            await asyncio.sleep(0.15 + random.random() * 0.35)
                        except asyncio.CancelledError:
                            return
            try:
                self._correlation_veto()
            except Exception as e:
                logger.debug(f"correlation veto skip: {e}")
            # Record Satoshi's decision for the process metrics. Server-side
            # and deduped, so the log fills whether or not a browser is open.
            try:
                self._record_process()
            except Exception as e:
                logger.debug(f"process log skip: {e}")
            elapsed = asyncio.get_event_loop().time() - t0
            try:
                prof = runtime_settings.profile()
                beast = bool(runtime_settings.beast_mode or getattr(settings, "BEAST_MODE", False))
            except Exception:
                prof = {}
                beast = bool(getattr(settings, "BEAST_MODE", False))
            active = False
            if getattr(settings, "ADAPTIVE_INTERVAL", True):
                try:
                    active = self._tables_active()
                except Exception:
                    active = False
            interval = compute_dual_interval(
                beast=beast,
                active=active,
                profile=prof,
                adaptive=bool(getattr(settings, "ADAPTIVE_INTERVAL", True)),
            )
            sleep_for = max(0.4, interval - elapsed)
            try:
                await asyncio.sleep(sleep_for)
            except asyncio.CancelledError:
                break

    def _record_process(self) -> None:
        """One deduped process row per distinct Satoshi decision."""
        from backend.learning.leader_ranks import rank_book
        from backend.services.process_log import process_log
        from backend.services.round_table import build_round_table

        btc = self.btc.get_state() if self.btc else {}
        eth = self.eth.get_state() if self.eth else None
        board = build_round_table(btc, eth_table=eth, standings=rank_book().standings())
        market = btc.get("market") if isinstance(btc.get("market"), dict) else {}
        ref = market.get("kalshi_ticker") or market.get("ticker") or market.get("close_time")
        process_log().record_decision(board, ref=ref)

    def get_state(self) -> Dict[str, Any]:
        btc_state = self.btc.get_state()
        eth_state = self.eth.get_state() if self.eth else None
        # Back-compat top-level = BTC so older UI still renders
        base = {k: v for k, v in btc_state.items() if k not in ("tables", "btc", "eth", "dual")}
        btc_acc = (btc_state or {}).get("accuracy") or {}
        eth_acc = (eth_state or {}).get("accuracy") or {}
        base.update({
            "mode": "dual",
            "dual": True,
            "tables": {
                "bitcoin": btc_state,
                "ethereum": eth_state,
            },
            "btc": btc_state,
            "eth": eth_state,
            "leaders": {
                "bitcoin": "satoshi",
                "ethereum": "vitalik" if self.eth else None,
            },
            "scorecard": floor_scorecard(btc_acc, eth_acc),
        })
        return base

    async def analyze_once(self) -> Dict[str, Any]:
        async with self._analyze_lock:
            await self.btc.analyze_once()
            self._feed_btc_lead()
            if self.eth:
                await self.eth.analyze_once()
        return self.get_state()
