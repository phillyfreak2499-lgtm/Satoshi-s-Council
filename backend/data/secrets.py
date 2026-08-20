from __future__ import annotations
import os
from typing import Tuple

def load_secret_string(env_name: str, _file_name: str | None = None) -> Tuple[str, str]:
    val = (os.environ.get(env_name) or "").strip()
    return val, "env" if val else ""

def load_coinglass_api_key() -> str:
    return (os.environ.get("COINGLASS_API_KEY") or "").strip()
