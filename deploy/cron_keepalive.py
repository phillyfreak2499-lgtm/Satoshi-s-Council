"""Render Cron: ping health so free-tier services stay warm."""
from __future__ import annotations
import os
import sys
import httpx

base = os.environ.get("COUNCIL_URL", "").rstrip("/")
if base and not base.startswith("http"):
    base = "https://" + base
if not base:
    print("COUNCIL_URL not set", file=sys.stderr)
    sys.exit(1)

url = base + "/health"
try:
    r = httpx.get(url, timeout=30.0)
    print(f"keepalive GET {url} → {r.status_code} {r.text[:200]}")
except Exception as e:
    print(f"keepalive failed: {e}", file=sys.stderr)
    sys.exit(1)
