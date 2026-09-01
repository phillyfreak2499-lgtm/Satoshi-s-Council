"""Paid membership removed. Endpoints that still import this module fail closed."""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple


def configured() -> bool:
    return False


def create_checkout_session(account_id: str, email: Optional[str] = None) -> Dict[str, Any]:
    raise RuntimeError("paid membership is disabled")


def retrieve_checkout_session(session_id: str) -> Dict[str, Any]:
    raise RuntimeError("paid membership is disabled")


async def handle_webhook(payload: bytes, sig_header: str, store: Any) -> Tuple[bool, str]:
    return False, "paid membership is disabled"
