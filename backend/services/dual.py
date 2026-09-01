"""
Dual-table orchestrator: Bitcoin (Satoshi) + Ethereum (Vitalik).
Sequential analysis on a shared event loop for ~2 CPU / 4 GB hosts.
Proxies store/leader/learner/huddle/law to BTC so existing main.py routes keep working.
"""
from __future__ import annotations
import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from loguru import logger
from backend.config import settings
from backend.services.council import Council
from backend.agents.chair_gates import build_btc_lead, floor_scorecard

DUAL_FLOOR_S = 2.0
BEAST_FLOOR_S = 1.2
ANALYZE_TIMEOUT_S = 15.0
INIT_TIMEOUT_S = 20.0
STORE_RETRY_S = 30.0
LOCK_WAIT_S = 4.0
SETTLE_BUDGET_S = 3.5
PAINT_TIMEOUT_S = 4.0


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


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class DualOrchestrator:
    def __init__(self):
        self.btc = Council(asset="btc", leader_name="satoshi")
        self.eth: Optional[Council] = None
        if getattr(settings, "ENABLE_ETH_TABLE", True):
            self.eth = Council(asset="eth", leader_name="vitalik")
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self._backfill_task: Optional[asyncio.Task] = None
        self._closer_task: Optional[asyncio.Task] = None
        self._last_wal_ckpt = 0.0
        self._store_ready = False
        self._last_store_retry = 0.0
        self.loop_heartbeat = 0.0
        self._analyze_lock = asyncio.Lock()
        self._settle_capped = False

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

    def _cap_settle(self) -> None:
        """settle_due_windows used to scan 24 Kalshi events every tick and
        eat the whole 15s Dual budget. Cap it so fetch+vote can finish."""
        if self._settle_capped:
            return
        orig = Council.settle_due_windows

        async def _capped(self_c, *args, **kwargs):
            try:
                return await asyncio.wait_for(orig(self_c, *args, **kwargs), timeout=SETTLE_BUDGET_S)
            except asyncio.TimeoutError:
                logger.warning(
                    f"[{getattr(self_c, 'asset', '?')}] settle_due_windows "
                    f"timed out at {SETTLE_BUDGET_S:.1f}s — vote path continues"
                )
                return 0

        Council.settle_due_windows = _capped
        self._settle_capped = True

    def _touch(self, c: Council, reason: str = "ok") -> None:
        """Bump latest_state.timestamp as ISO so /health.state_age_s moves.

        health._age() only parses ISO datetimes. Writing time.time() floats
        made state_age_s go null even while the loop was alive.
        Always stamp the cycle, even on timeout / lock busy.
        """
        now = time.time()
        iso = _iso_now()
        self.loop_heartbeat = now
        try:
            st = dict(getattr(c, "latest_state", None) or {})
            st["timestamp"] = iso
            st["loop_heartbeat"] = iso
            st["loop_heartbeat_unix"] = now
            st["loop_reason"] = reason
            health = dict(st.get("health") or {})
            health["cycle"] = reason
            st["health"] = health
            c.latest_state = st
        except Exception:
            pass
        try:
            c._loop_heartbeat = now
        except Exception:
            pass

    async def _paint_feeds(self, c: Council, reason: str = "timeout") -> None:
        """Keep the 15m clock + spot flags alive when analyze_once cannot finish."""
        try:
            md = await asyncio.wait_for(c.pipeline.fetch(), timeout=PAINT_TIMEOUT_S)
        except Exception as e:
            logger.debug(f"paint feeds skip ({c.asset}): {e}")
            return
        if not isinstance(md, dict):
            return
        try:
            st = dict(getattr(c, "latest_state", None) or {})
            km = md.get("kalshi_market") if isinstance(md.get("kalshi_market"), dict) else {}
            mkt = dict(st.get("market") or {})
            ticker = (
                km.get("ticker")
                or md.get("market_ticker")
                or md.get("ticker")
                or mkt.get("ticker")
                or mkt.get("kalshi_ticker")
            )
            close_time = km.get("close_time") or md.get("close_time") or mkt.get("close_time")
            price = md.get("current_price") or md.get("price") or mkt.get("price")
            mins_left = md.get("mins_left")
            if mins_left is None and close_time:
                try:
                    from backend.learning.regime_keys import parse_mins_left
                    mins_left = parse_mins_left(close_time)
                except Exception:
                    mins_left = None
            try:
                from backend.learning.btc15m import window_minutes_for
                win_mins = window_minutes_for(asset=c.asset, ticker=ticker)
            except Exception:
                win_mins = 15.0
            mkt.update({
                "price": price,
                "kalshi_ticker": ticker,
                "ticker": ticker,
                "close_time": close_time,
                "mins_left": mins_left,
                "seconds_left": (float(mins_left) * 60.0) if mins_left is not None else mkt.get("seconds_left"),
                "kalshi_yes_bid": md.get("kalshi_yes_bid", mkt.get("kalshi_yes_bid")),
                "kalshi_yes_ask": md.get("kalshi_yes_ask", mkt.get("kalshi_yes_ask")),
                "up_pct": md.get("up_pct", mkt.get("up_pct")),
                "down_pct": md.get("down_pct", mkt.get("down_pct")),
                "window_minutes": win_mins,
                "stale": bool(md.get("stale") or (md.get("kalshi") or {}).get("stale")),
            })
            st["market"] = mkt
            st["fetch_ms"] = md.get("fetch_ms")
            health = dict(st.get("health") or {})
            health.update(md.get("health") or {})
            if md.get("fetch_ms") is not None:
                health["last_fetch_ms"] = md.get("fetch_ms")
            health["cycle"] = reason
            st["health"] = health
            lock_tl = dict(st.get("lock_timeline") or {})
            lock_tl["close_time"] = close_time
            lock_tl["mins_left"] = mins_left
            st["lock_timeline"] = lock_tl
            c.latest_state = st
        except Exception as e:
            logger.debug(f"paint feeds merge skip ({c.asset}): {e}")

    async def _ensure_store(self) -> None:
        if self._store_ready:
            return
        now = time.time()
        if now - self._last_store_retry < STORE_RETRY_S and self._last_store_retry:
            return
        self._last_store_retry = now
        try:
            await asyncio.wait_for(self.btc.store.init(), timeout=INIT_TIMEOUT_S)
            self._store_ready = True
            if self.eth and self.eth.store is not self.btc.store:
                self.eth.store = self.btc.store
            logger.info("store.init recovered")
        except asyncio.TimeoutError:
            logger.warning(f"store.init retry timed out after {INIT_TIMEOUT_S:.0f}s")
        except Exception as e:
            logger.warning(f"store.init retry failed: {e}")

    async def start(self):
        self._cap_settle()
        for c in self._councils():
            try:
                c.ensure_seat_shell("warming")
            except Exception as e:
                logger.debug(f"seat shell {c.asset}: {e}")
            c.running = True
            self._touch(c, "warming")
        self.running = True
        self.loop_heartbeat = time.time()

        try:
            await asyncio.wait_for(self.btc.store.init(), timeout=INIT_TIMEOUT_S)
            self._store_ready = True
        except asyncio.TimeoutError:
            logger.warning(
                f"store.init timed out after {INIT_TIMEOUT_S:.0f}s — analysis loop still starts"
            )
        except Exception as e:
            logger.warning(f"store.init failed: {e}")
        if self.eth and self.eth.store is not self.btc.store:
            self.eth.store = self.btc.store

        self._task = asyncio.create_task(self._loop())
        self._last_wal_ckpt = 0.0

        async def _boot_store():
            try:
                pruned = await asyncio.wait_for(self.btc.store.prune_old_signals(), timeout=30)
                if pruned:
                    logger.info(f"Boot prune: removed {pruned} old signal rows")
            except Exception as e:
                logger.debug(f"boot signal prune skip: {e}")
            try:
                await asyncio.wait_for(self.btc.store.ensure_eth_display_reset(), timeout=15)
            except Exception as e:
                logger.debug(f"ETH display reset skip: {e}")
            try:
                await asyncio.wait_for(self.btc.store.ensure_btc_15m_display_reset(), timeout=15)
            except Exception as e:
                logger.debug(f"BTC 15m display reset skip: {e}")
            for c in self._councils():
                try:
                    if hasattr(c.learner, "load"):
                        c.learner.load()
                except Exception as e:
                    logger.debug(f"learner load {c.asset}: {e}")
                try:
                    await asyncio.wait_for(c.hydrate_persisted_desk(), timeout=20)
                except Exception as e:
                    logger.debug(f"desk hydrate {c.asset}: {e}")

        asyncio.create_task(_boot_store(), name="boot-store")

        async def _boot_closers():
            for c in self._councils():
                try:
                    n = await asyncio.wait_for(c.sweep_official_finishes(), timeout=75)
                    if n:
                        logger.info(f"[{c.asset}] Official closer swept {n} open hour(s)")
                except asyncio.TimeoutError:
                    logger.warning(
                        f"[{c.asset}] Official closer timed out — analysis loop already running"
                    )
                except Exception as e:
                    logger.debug(f"official closer sweep skip ({c.asset}): {e}")
            try:
                await self.btc.store.checkpoint_wal()
            except Exception as e:
                logger.debug(f"boot wal checkpoint skip: {e}")

        self._closer_task = asyncio.create_task(_boot_closers(), name="boot-closers")
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
        if self._closer_task:
            self._closer_task.cancel()
            try:
                await self._closer_task
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
        from backend.config import settings
        if not getattr(settings, "DUAL_CORRELATION_VETO", True):
            return
        if not self.eth:
            return
        b = (self.btc.latest_state or {}).get("decision") or {}
        e = (self.eth.latest_state or {}).get("decision") or {}
        bd = (b.get("direction") or "").upper()
        ed = (e.get("direction") or "").upper()
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
            try:
                await self._ensure_store()
            except Exception as e:
                logger.debug(f"store retry skip: {e}")
            got_lock = False
            try:
                await asyncio.wait_for(self._analyze_lock.acquire(), timeout=LOCK_WAIT_S)
                got_lock = True
            except asyncio.TimeoutError:
                logger.warning("analyze lock busy — heartbeat, paint feeds, skip this tick")
                for c in councils:
                    self._touch(c, "lock_busy")
                    try:
                        await self._paint_feeds(c, "lock_busy")
                    except Exception:
                        pass
                    try:
                        c.ensure_seat_shell("lock busy")
                    except Exception:
                        pass
            except asyncio.CancelledError:
                return
            if got_lock:
                try:
                    for i, c in enumerate(councils):
                        if not self.running:
                            break
                        try:
                            await asyncio.wait_for(c.analyze_once(), timeout=ANALYZE_TIMEOUT_S)
                            self._touch(c, "ok")
                        except asyncio.TimeoutError:
                            logger.warning(
                                f"Dual analysis hung ({c.asset}) after {ANALYZE_TIMEOUT_S:.0f}s — painting feeds"
                            )
                            self._touch(c, "timeout")
                            try:
                                await self._paint_feeds(c, "timeout")
                            except Exception:
                                pass
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
                            self._touch(c, "error")
                            try:
                                await self._paint_feeds(c, "error")
                            except Exception:
                                pass
                            try:
                                c.ensure_seat_shell("cycle error")
                            except Exception:
                                pass
                            try:
                                await asyncio.wait_for(c.settle_due_windows(), timeout=SETTLE_BUDGET_S)
                            except Exception as se:
                                logger.debug(f"Dual settle-after-error skip ({c.asset}): {se}")
                        if c.asset == "btc":
                            self._feed_btc_lead()
                        if i < len(councils) - 1:
                            try:
                                await asyncio.sleep(0.15 + random.random() * 0.35)
                            except asyncio.CancelledError:
                                return
                finally:
                    if self._analyze_lock.locked():
                        self._analyze_lock.release()
            try:
                self._correlation_veto()
            except Exception as e:
                logger.debug(f"correlation veto skip: {e}")
            try:
                self._record_process()
            except Exception as e:
                logger.debug(f"process log skip: {e}")
            try:
                now = asyncio.get_event_loop().time()
                if now - getattr(self, "_last_wal_ckpt", 0.0) > 600:
                    self._last_wal_ckpt = now
                    await self.btc.store.checkpoint_wal()
            except Exception as e:
                logger.debug(f"periodic wal checkpoint skip: {e}")
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
            "loop_heartbeat": self.loop_heartbeat,
        })
        return base

    async def analyze_once(self) -> Dict[str, Any]:
        async with self._analyze_lock:
            await self.btc.analyze_once()
            self._touch(self.btc, "ok")
            self._feed_btc_lead()
            if self.eth:
                await self.eth.analyze_once()
                self._touch(self.eth, "ok")
        return self.get_state()
