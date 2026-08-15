"""One-pass 90-day Kalshi seat backfill on the box (DATA_DIR).

Paper. Follower OFF. No live orders. Merge into live brains.

  python -m backend.learning.seat_backfill --contract
  python -m backend.learning.seat_backfill
  python deploy/seat_backfill.py
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.learning.seat_backfill import _cli

if __name__ == "__main__":
    raise SystemExit(_cli())
