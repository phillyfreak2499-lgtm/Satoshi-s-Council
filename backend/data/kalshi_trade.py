"""
Authenticated Kalshi order placement (Follower live only).

RSA-PSS headers. Never log the PEM, key id, or order payload secrets.
Fail closed when keys are missing.
"""
from __future__ import annotations

import base64
import time
import uuid
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from loguru import logger

from backend.config import settings
from backend.data.secrets import load_secret_string

_ORDER_PATH = "/portfolio/events/orders"


def _load_key_id() -> str:
    val, _src = load_secret_string("KALSHI_API_KEY", "KALSHI_API_KEY")
    return (val or "").strip()


def _load_private_pem() -> str:
    path = (getattr(settings, "KALSHI_PRIVATE_KEY_PATH", None) or "").strip()
    if path:
        val, _src = load_secret_string("KALSHI_PRIVATE_KEY_PATH", path.split("/")[-1])
        if val and "BEGIN" in val:
            return val
        try:
            from pathlib import Path
            if Path(path).is_file():
                text = Path(path).read_text(encoding="utf-8").strip()
                if text:
                    return text
        except OSError:
            pass
    val, _src = load_secret_string("KALSHI_PRIVATE_KEY", "kalshi.pem")
    return (val or "").strip()


def trade_creds_ready() -> bool:
    return bool(_load_key_id() and _load_private_pem())


def yes_price_dollars(raw: Any) -> Optional[str]:
    """Normalize cents / pct / dollars to a Kalshi fixed-point dollar string."""
    if raw is None or raw == "":
        return None
    try:
        x = float(raw)
    except (TypeError, ValueError):
        return None
    if x > 1.5:
        x = x / 100.0
    if x <= 0 or x >= 1:
        return None
    return f"{max(0.01, min(0.99, x)):.4f}"


def book_side_for_lock(direction: str) -> Optional[str]:
    """V2 book is YES-only: bid = buy YES (UP), ask = sell YES / buy NO (DOWN)."""
    d = str(direction or "").strip().upper()
    if d == "UP":
        return "bid"
    if d == "DOWN":
        return "ask"
    return None


def sign_request(pem: str, timestamp: str, method: str, path: str) -> str:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    path_without_query = (path or "").split("?", 1)[0]
    message = f"{timestamp}{method}{path_without_query}".encode("utf-8")
    key = serialization.load_pem_private_key(pem.encode("utf-8"), password=None)
    sig = key.sign(
        message,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.DIGEST_LENGTH,
        ),
        hashes.SHA256(),
    )
    return base64.b64encode(sig).decode("ascii")


def _sign_path(base: str, rel: str) -> str:
    return urlparse(base.rstrip("/") + rel).path


class KalshiTradeClient:
    def __init__(
        self,
        *,
        key_id: str = "",
        pem: str = "",
        base: str | None = None,
        http: Any = None,
    ):
        self.key_id = (key_id or "").strip()
        self._pem = (pem or "").strip()
        self.base = (base or settings.KALSHI_BASE).rstrip("/")
        self._http = http

    @classmethod
    def from_settings(cls) -> "KalshiTradeClient":
        return cls(key_id=_load_key_id(), pem=_load_private_pem())

    def ready(self) -> bool:
        return bool(self.key_id and self._pem and "BEGIN" in self._pem)

    def _headers(self, method: str, rel: str) -> Dict[str, str]:
        ts = str(int(time.time() * 1000))
        return {
            "KALSHI-ACCESS-KEY": self.key_id,
            "KALSHI-ACCESS-TIMESTAMP": ts,
            "KALSHI-ACCESS-SIGNATURE": sign_request(
                self._pem, ts, method, _sign_path(self.base, rel)
            ),
            "Content-Type": "application/json",
        }

    async def create_order(
        self,
        *,
        ticker: str,
        direction: str,
        contracts: int,
        yes_price: Any,
        client_order_id: str | None = None,
    ) -> Dict[str, Any]:
        if not self.ready():
            return {"ok": False, "refuse": "no_keys"}
        side = book_side_for_lock(direction)
        price = yes_price_dollars(yes_price)
        tick = str(ticker or "").strip()
        count = max(1, min(100, int(contracts or 1)))
        if not tick or side is None or price is None:
            return {"ok": False, "refuse": "quote"}
        body = {
            "ticker": tick,
            "side": side,
            "count": f"{count:.2f}",
            "price": price,
            "time_in_force": "immediate_or_cancel",
            "self_trade_prevention_type": "taker_at_cross",
            "client_order_id": client_order_id or str(uuid.uuid4()),
        }
        import httpx

        own = self._http is None
        client = self._http or httpx.AsyncClient(timeout=8.0, follow_redirects=True)
        try:
            r = await client.post(
                self.base + _ORDER_PATH,
                headers=self._headers("POST", _ORDER_PATH),
                json=body,
            )
        except Exception as e:
            logger.warning(f"Kalshi live order transport failed: {type(e).__name__}")
            return {"ok": False, "refuse": "broker"}
        finally:
            if own:
                await client.aclose()
        if r.status_code in (200, 201):
            data = r.json() if r.content else {}
            if not isinstance(data, dict):
                data = {}
            return {
                "ok": True,
                "refuse": "",
                "order_id": str(data.get("order_id") or ""),
                "fill_count": data.get("fill_count"),
                "remaining_count": data.get("remaining_count"),
            }
        if r.status_code in (401, 403):
            return {"ok": False, "refuse": "broker"}
        if r.status_code == 409:
            return {"ok": False, "refuse": "broker"}
        logger.warning(f"Kalshi live order refused: HTTP {r.status_code}")
        return {"ok": False, "refuse": "broker"}


def quote_yes_price(lock: Dict[str, Any]) -> Any:
    side = str((lock or {}).get("side") or "").upper()
    if side == "UP":
        return (lock or {}).get("yes_ask") or (lock or {}).get("up_pct")
    if side == "DOWN":
        return (lock or {}).get("yes_bid") or (lock or {}).get("up_pct")
    return None
