"""
Load Render secret-file values without ever logging the secret itself.

Same pattern as kalshi.pem: env first, then /etc/secrets/<NAME>.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional, Tuple

from loguru import logger

_CACHE: dict[str, Tuple[Optional[str], str]] = {}


def _read_key_file(path: str) -> Optional[str]:
    try:
        if not path or not os.path.isfile(path):
            return None
        text = Path(path).read_text(encoding="utf-8").strip()
        return text or None
    except OSError:
        return None


def secret_file_candidates(env_name: str, file_name: str) -> list[str]:
    """Paths Render (and local) may mount a secret file named `file_name`."""
    out: list[str] = []
    file_env = (os.environ.get(f"{env_name}_FILE") or "").strip()
    if file_env:
        out.append(file_env)
    secrets_dir = (os.environ.get("RENDER_SECRETS_DIR") or "/etc/secrets").strip()
    out.extend(
        [
            f"/etc/secrets/{file_name}",
            f"/etc/secrets/{file_name}.txt",
            os.path.join(secrets_dir, file_name),
        ]
    )
    kalshi = (os.environ.get("KALSHI_PRIVATE_KEY_PATH") or "").strip()
    if kalshi:
        out.append(os.path.join(os.path.dirname(kalshi), file_name))
    data_dir = (os.environ.get("DATA_DIR") or "").strip()
    if data_dir:
        out.append(os.path.join(data_dir, file_name))
    # de-dupe, keep order
    seen: set[str] = set()
    uniq: list[str] = []
    for p in out:
        if p and p not in seen:
            seen.add(p)
            uniq.append(p)
    return uniq


def load_secret_string(env_name: str, file_name: str | None = None) -> Tuple[Optional[str], str]:
    """
    1) env VAR (key string, or a path to the file)
    2) Render secret file /etc/secrets/<file_name> and siblings
    Returns (value, source) where source is 'env' | 'file' | ''.
    Never log the value.
    """
    file_name = file_name or env_name
    raw = (os.environ.get(env_name) or "").strip()
    if raw:
        if os.path.isfile(raw):
            val = _read_key_file(raw)
            if val:
                return val, "file"
        return raw, "env"
    for path in secret_file_candidates(env_name, file_name):
        val = _read_key_file(path)
        if val:
            return val, "file"
    return None, ""


def reset_secret_cache(env_name: str | None = None) -> None:
    if env_name is None:
        _CACHE.clear()
    else:
        _CACHE.pop(env_name, None)


def load_coinglass_api_key() -> Optional[str]:
    """CoinGlass key from env or the Render secret file named COINGLASS_API_KEY."""
    cached = _CACHE.get("COINGLASS_API_KEY")
    if cached is None:
        val, src = load_secret_string("COINGLASS_API_KEY", "COINGLASS_API_KEY")
        _CACHE["COINGLASS_API_KEY"] = (val, src)
        if src:
            logger.info(f"CoinGlass API key loaded from {src}")
        else:
            logger.warning(
                "CoinGlass API key missing — CARRY/CHAIN/CASCADE use Binance fallback only"
            )
        cached = (val, src)
    return cached[0]
