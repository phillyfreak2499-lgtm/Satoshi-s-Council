"""
Coinbase BTC-USD spot — second price source for dual-spot consensus.
Public REST, no auth. Used when DUAL_SPOT=True.
"""
from __future__ import annotations
from typing import Any, Dict, Optional
import httpx
from loguru import logger
from backend.config import settings


class CoinbaseClient:
    BASE = "https://api.exchange.coinbase.com"

    def __init__(self, product_id: str | None = None):
        self.product_id = product_id or "BTC-USD"
        timeout = httpx.Timeout(float(getattr(settings, "HTTP_TIMEOUT", 4.0)), connect=3.0)
        self.client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
        self.last_price: Optional[float] = None

    async def close(self):
        await self.client.aclose()

    async def get_spot(self) -> Dict[str, Any]:
        try:
            r = await self.client.get(f"{self.BASE}/products/{self.product_id}/ticker")
            r.raise_for_status()
            data = r.json()
            price = float(data.get("price") or data.get("last") or 0)
            if price > 0:
                self.last_price = price
            return {
                "source": "coinbase",
                "healthy": price > 0,
                "price": price if price > 0 else self.last_price,
                "bid": float(data["bid"]) if data.get("bid") else None,
                "ask": float(data["ask"]) if data.get("ask") else None,
            }
        except Exception as e:
            logger.debug(f"Coinbase spot fail: {e}")
            return {
                "source": "coinbase",
                "healthy": False,
                "price": self.last_price,
                "error": str(e),
            }
