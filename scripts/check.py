#!/usr/bin/env python3
"""Deploy check for roundtable.js + critical backend files.

Prefers `node --check frontend/static/roundtable.js`. Render's Python
runtime may not have node, so we still fail closed on the known dark-desk
shape (missing isPhoneDesk) and run node --check whenever node exists.

Also reject a stubbed dual.py — that exact failure froze the live desk
when a commit replaced DualOrchestrator with the word PLACEHOLDER.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "frontend" / "static" / "roundtable.js"
FX = ROOT / "frontend" / "static" / "desk-fx.js"
DUAL = ROOT / "backend" / "services" / "dual.py"
BTC15 = ROOT / "backend" / "learning" / "btc15m.py"


def _reject_stub(path: Path, must_contain: str) -> int:
    if not path.is_file():
        print(f"FAIL: {path.relative_to(ROOT)} missing", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    stripped = text.strip()
    if stripped in {"PLACEHOLDER", "placeholder", "TODO", "stub"} or len(stripped) < 200:
        print(
            f"FAIL: {path.relative_to(ROOT)} is a stub ({len(stripped)} bytes) — "
            f"refusing to deploy a frozen desk",
            file=sys.stderr,
        )
        return 1
    if must_contain not in text:
        print(
            f"FAIL: {path.relative_to(ROOT)} missing {must_contain!r}",
            file=sys.stderr,
        )
        return 1
    print(f"ok: {path.relative_to(ROOT)} ({len(text)} bytes)")
    return 0


def main() -> int:
    rc = _reject_stub(DUAL, "class DualOrchestrator")
    if rc:
        return rc
    rc = _reject_stub(BTC15, "def is_15m_window")
    if rc:
        return rc

    text = JS.read_text(encoding="utf-8")
    if "function isPhoneDesk()" not in text:
        print("FAIL: function isPhoneDesk() missing from roundtable.js", file=sys.stderr)
        return 1
    node = shutil.which("node") or shutil.which("nodejs")
    if node:
        for path in (JS, FX):
            r = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
            if r.returncode != 0:
                sys.stderr.write(r.stderr or r.stdout or f"node --check {path.name} failed\n")
                return r.returncode or 1
            print(f"ok: node --check frontend/static/{path.name}")
        return 0
    print("warn: node not on PATH; skipped parse check (isPhoneDesk present)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
