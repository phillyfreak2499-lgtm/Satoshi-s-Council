"""
Dual-table orchestrator: Bitcoin (Satoshi) + Ethereum (Vitalik).
Sequential analysis on a shared event loop for ~2 CPU / 4 GB hosts.
"""
from __future__ import annotations
import asyncio
from typing import Any, Dict, Optional
from loguru import logger
from backend.config import settings
from backend.services.council import Council


class DualOrchestrator:
    def __init__(self):
        self.btc = Council(asset="btc", leader_name="satoshi")
        self.eth: Optional[Council] = None
        if getattr(settings, "ENABLE_ETH_TABLE", True):
            self.eth = Council(asset="eth", leader_name="vitalik")
        self.running = False
        self._task: Optional[asyncio.Task] = None

    async def start(self):
        # Init stores/learners without starting per-council loops
        await self.btc.store.init()
        if self.eth:
            await self.eth.store.init()
        # Seed / load in background-safe way (reuse Council.start partial)
        for c in self._councils():
            try:
                if hasattr(c.learner, "load"):
                    c.learner.load()
            except Exception as e:
                logger.debug(f"learner load {c.asset}: {e}")
            c.running = True
        self.running = True
        self._task = asyncio.create_task(self._loop())
        logger.info(
            f"DualOrchestrator started (btc=on eth={'on' if self.eth else 'off'} sequential={settings.DUAL_SEQUENTIAL})"
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

    async def _loop(self):
        while self.running:
            t0 = asyncio.get_event_loop().time()
            # Sequential: BTC then ETH (keeps peak CPU predictable)
            for c in self._councils():
                if not self.running:
                    break
                try:
                    await c.analyze_once()
                except Exception as e:
                    logger.exception(f"Dual analysis error ({c.asset}): {e}")
            elapsed = asyncio.get_event_loop().time() - t0
            # Pace: use the longer of the two intervals as the full dual-cycle sleep base
            interval = max(
                float(getattr(settings, "ANALYSIS_INTERVAL_BTC", 4.0)),
                float(getattr(settings, "ANALYSIS_INTERVAL_ETH", 4.0)),
            )
            if getattr(settings, "BEAST_MODE", False):
                interval = max(2.5, interval * 0.7)
            sleep_for = max(0.5, interval - elapsed)
            try:
                await asyncio.sleep(sleep_for)
            except asyncio.CancelledError:
                break

    def get_state(self) -> Dict[str, Any]:
        btc_state = self.btc.get_state()
        eth_state = self.eth.get_state() if self.eth else None
        return {
            "mode": "dual",
            "tables": {
                "bitcoin": btc_state,
                "ethereum": eth_state,
            },
            # Back-compat: top-level mirrors BTC so old UI still renders something
            **{k: v for k, v in btc_state.items() if k not in ("tables",)},
            "btc": btc_state,
            "eth": eth_state,
            "dual": True,
            "leaders": {
                "bitcoin": "satoshi",
                "ethereum": "vitalik" if self.eth else None,
            },
        }

    async def analyze_once(self) -> Dict[str, Any]:
        await self.btc.analyze_once()
        if self.eth:
            await self.eth.analyze_once()
        return self.get_state()
