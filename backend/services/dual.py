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
from backend.agents.chair_gates import build_btc_lead

DUAL_FLOOR_S = 2.0
BEAST_FLOOR_S = 1.2


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
                n = await c.sweep_official_finishes()
                if n:
                    logger.info(f"[{c.asset}] Official closer swept {n} open hour(s)")
            except Exception as e:
                logger.debug(f"official closer sweep skip ({c.asset}): {e}")
            c.running = True
        self.running = True
        self._task = asyncio.create_task(self._loop())
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
            for i, c in enumerate(councils):
                if not self.running:
                    break
                try:
                    await c.analyze_once()
                except Exception as e:
                    logger.exception(f"Dual analysis error ({c.asset}): {e}")
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

    def get_state(self) -> Dict[str, Any]:
        btc_state = self.btc.get_state()
        eth_state = self.eth.get_state() if self.eth else None
        # Back-compat top-level = BTC so older UI still renders
        base = {k: v for k, v in btc_state.items() if k not in ("tables", "btc", "eth", "dual")}
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
        })
        return base

    async def analyze_once(self) -> Dict[str, Any]:
        await self.btc.analyze_once()
        self._feed_btc_lead()
        if self.eth:
            await self.eth.analyze_once()
        return self.get_state()
