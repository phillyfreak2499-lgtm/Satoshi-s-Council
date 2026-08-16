"""One-pass official Kalshi 15m BTC seat backfill on the box (DATA_DIR).

Paper. Follower OFF. No live orders. Merge into the Satoshi 15m brain.
Does not write window_calls / displayed Chair hits.

  python -m backend.learning.seat_backfill_15m --contract
  python -m backend.learning.seat_backfill_15m
  python deploy/seat_backfill_15m.py
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.learning.seat_backfill_15m import _cli

if __name__ == "__main__":
    raise SystemExit(_cli())
