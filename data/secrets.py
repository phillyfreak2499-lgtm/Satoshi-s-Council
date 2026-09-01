from __future__ import annotations

import os
from pathlib import Path
from typing import Tuple


_SECRET_DIRS = (
    Path("/etc/secrets"),
    Path("/run/secrets"),
)


def load_secret_string(env_name: str, _file_name: str | None = None) -> Tuple[str, str]:
    """Env first, then a mounted secret file. Never logs the value."""
    val = (os.environ.get(env_name) or "").strip()
    if val:
        return val, "env"
    names = []
    if _file_name:
        names.append(str(_file_name))
    names.append(env_name)
    seen = set()
    for name in names:
        if not name or name in seen:
            continue
        seen.add(name)
        for root in _SECRET_DIRS:
            path = root / name
            try:
                if path.is_file():
                    text = path.read_text(encoding="utf-8").strip()
                    if text:
                        return text, "file"
            except OSError:
                continue
    return "", ""


def load_coinglass_api_key() -> str:
    val, _src = load_secret_string("COINGLASS_API_KEY")
    return val
