#!/usr/bin/env python3
"""Deploy check for roundtable.js.

Prefers `node --check frontend/static/roundtable.js`. Render's Python
runtime may not have node, so we still fail closed on the known dark-desk
shape (missing isPhoneDesk) and run node --check whenever node exists.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "frontend" / "static" / "roundtable.js"


def main() -> int:
    text = JS.read_text(encoding="utf-8")
    if "function isPhoneDesk()" not in text:
        print("FAIL: function isPhoneDesk() missing from roundtable.js", file=sys.stderr)
        return 1
    node = shutil.which("node") or shutil.which("nodejs")
    if node:
        r = subprocess.run([node, "--check", str(JS)], capture_output=True, text=True)
        if r.returncode != 0:
            sys.stderr.write(r.stderr or r.stdout or "node --check failed\n")
            return r.returncode or 1
        print("ok: node --check frontend/static/roundtable.js")
        return 0
    print("warn: node not on PATH; skipped parse check (isPhoneDesk present)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
