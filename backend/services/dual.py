"""
Dual-table orchestrator: Bitcoin (Satoshi) + Ethereum (Vitalik).
Sequential analysis on a shared event loop for ~2 CPU / 4 GB hosts.
Proxies store/leader/learner/huddle/law to BTC so existing main.py routes keep working.
"""
from __future__ import annotations
import asyncio
from typing import Any, Dict, Optional
from loguru import logger
from backend.config import settings
from backend.services.council import Council
from backend.agents.chair_gates import build_btc_lead, floor_scorecard

DUAL_FLOOR_S = 2.0
BEAST_FLOOR_S = 1.2
ANALYZE_TIMEOUT_S = 15.0
INIT_TIMEOUT_S = 20.0
