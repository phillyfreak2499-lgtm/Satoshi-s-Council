"""
Shared desk gate. Compare submitted access against env (or secret file).

Never log, print, or return the stored or submitted value.
Fail closed when the env is unset. Wrong answer is always generic.
"""
from __future__ import annotations

import hashlib
import hmac
from typing import Any, Dict

from backend.data.secrets import load_secret_string

ENV_NAME = "COUNCIL_ACCESS_PASSWORD"
WRONG = "Wrong password"


def _clean(text: Any) -> str:
    if text is None:
        return ""
    return str(text).replace("\ufeff", "").strip()


def load_desk_password() -> str:
    """Read the desk access secret. Never log the value."""
    val, _src = load_secret_string(ENV_NAME, ENV_NAME)
    return val or ""


def passwords_match(got: Any, want: str) -> bool:
    """Constant-time compare via hashes so length cannot leak."""
    submitted = _clean(got)
    expected = want if isinstance(want, str) else ""
    left = hashlib.sha256(submitted.encode("utf-8")).digest()
    if not expected:
        hmac.compare_digest(left, hashlib.sha256(b"\0").digest())
        return False
    right = hashlib.sha256(expected.encode("utf-8")).digest()
    return hmac.compare_digest(left, right)


def unlock_result(submitted: Any) -> Dict[str, Any]:
    """ok or generic wrong. Never include submitted or stored values."""
    if passwords_match(submitted, load_desk_password()):
        return {"ok": True}
    return {"ok": False, "error": WRONG}
