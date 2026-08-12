"""Render Cron: trigger nightly huddle on the web service (3 AM CT window)."""
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

url = base + "/api/huddle/run"
try:
    r = httpx.post(url, timeout=120.0)
    print(f"huddle POST {url} → {r.status_code}")
    print(r.text[:500])
    r.raise_for_status()
except Exception as e:
    print(f"huddle failed: {e}", file=sys.stderr)
    sys.exit(1)
