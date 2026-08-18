"""
PerformanceStore – persistent logging and analytics for Satoshi’s Council.
Tracks every signal, settles outcomes, computes rolling win-rates, Brier scores,
expectancy by confidence, and regime performance. Feeds the adaptive reweighter.
"""

from __future__ import annotations
import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import asdict
import logging

logger = logging.getLogger(__name__)

DEFAULT_DB = Path(__file__).resolve().parents[2] / "data" / "council.db"


class PerformanceStore:
    def __init__(self, db_path: str | Path = None):
        self.db_path = Path(db_path) if db_path else DEFAULT_DB
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._connect() as conn:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL NOT NULL,
                market_ticker TEXT,
                window_end REAL,
                leader_direction TEXT NOT NULL,
                leader_confidence REAL NOT NULL,
                agent_votes TEXT,          -- JSON
                features TEXT,             -- JSON
                actual_outcome TEXT,       -- UP / DOWN / null
                settled_at REAL,
                paper_pnl REAL,
                regime_tag TEXT
            );

            CREATE TABLE IF NOT EXISTS agent_stats (
                agent_name TEXT NOT NULL,
                window_size INTEGER NOT NULL,
                regime_tag TEXT NOT NULL DEFAULT 'all',
                win_rate REAL,
                brier_score REAL,
                n_signals INTEGER,
                n_directional INTEGER,
                last_updated REAL,
                PRIMARY KEY (agent_name, window_size, regime_tag)
            );

            CREATE TABLE IF NOT EXISTS weight_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL NOT NULL,
                agent_name TEXT NOT NULL,
                old_weight REAL,
                new_weight REAL,
                reason TEXT
            );

            CREATE TABLE IF NOT EXISTS regime_performance (
                regime_tag TEXT PRIMARY KEY,
                win_rate REAL,
                n_signals INTEGER,
                recommended_aggressiveness REAL,
                last_updated REAL
            );

            CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(timestamp);
            CREATE INDEX IF NOT EXISTS idx_signals_settled ON signals(actual_outcome);
            """)
            conn.commit()

    def log_signal(
        self,
        leader_direction: str,
        leader_confidence: float,
        agent_votes: Dict[str, Any],
        market_ticker: str = None,
        window_end: float = None,
        features: Dict = None,
        regime_tag: str = "all",
        timestamp: float = None,
    ) -> int:
        ts = timestamp or time.time()
        with self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO signals (
                    timestamp, market_ticker, window_end,
                    leader_direction, leader_confidence,
                    agent_votes, features, regime_tag
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ts,
                    market_ticker,
                    window_end,
                    leader_direction,
                    float(leader_confidence),
                    json.dumps(agent_votes),
                    json.dumps(features or {}),
                    regime_tag,
                ),
            )
            conn.commit()
            return cur.lastrowid

    def settle_signal(
        self,
        signal_id: int,
        actual_outcome: str,
        paper_pnl: float = None,
        settled_at: float = None,
    ):
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE signals
                SET actual_outcome = ?, paper_pnl = ?, settled_at = ?
                WHERE id = ?
                """,
                (actual_outcome, paper_pnl, settled_at or time.time(), signal_id),
            )
            conn.commit()

    def settle_latest_for_market(self, market_ticker: str, actual_outcome: str, paper_pnl: float = None):
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id FROM signals
                WHERE market_ticker = ? AND actual_outcome IS NULL
                ORDER BY timestamp DESC LIMIT 1
                """,
                (market_ticker,),
            ).fetchone()
            if row:
                self.settle_signal(row["id"], actual_outcome, paper_pnl)

    def update_agent_stats(self, window_sizes: List[int] = None, regime_tags: List[str] = None):
        window_sizes = window_sizes or [50, 100, 200]
        with self._connect() as conn:
            # Get all settled signals with agent votes
            rows = conn.execute(
                """
                SELECT agent_votes, leader_direction, actual_outcome, regime_tag
                FROM signals
                WHERE actual_outcome IS NOT NULL
                ORDER BY timestamp DESC
                """
            ).fetchall()

            if not rows:
                return

            # Aggregate per agent
            from collections import defaultdict
            agent_results = defaultdict(list)  # agent -> list of (correct: bool, brier_contrib, regime)

            for row in rows:
                votes = json.loads(row["agent_votes"] or "{}")
                actual = row["actual_outcome"]
                regime = row["regime_tag"] or "all"
                for agent_name, vote in votes.items():
                    if not isinstance(vote, dict):
                        continue
                    direction = vote.get("direction") or vote.get("dir")
                    conf = float(vote.get("confidence") or vote.get("conf") or 50) / 100.0
                    if direction in ("UP", "DOWN"):
                        correct = 1.0 if direction == actual else 0.0
                        # Brier for binary: (prob - outcome)^2 ; we treat conf as prob of the chosen direction
                        outcome_for_chosen = 1.0 if correct else 0.0
                        brier = (conf - outcome_for_chosen) ** 2
                        agent_results[agent_name].append((correct, brier, regime))

            now = time.time()
            for agent_name, results in agent_results.items():
                for ws in window_sizes:
                    window = results[:ws]
                    if not window:
                        continue
                    n = len(window)
                    wins = sum(r[0] for r in window)
                    win_rate = wins / n if n else 0.0
                    brier = sum(r[1] for r in window) / n if n else 1.0
                    # Also write overall
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO agent_stats
                        (agent_name, window_size, regime_tag, win_rate, brier_score, n_signals, n_directional, last_updated)
                        VALUES (?, ?, 'all', ?, ?, ?, ?, ?)
                        """,
                        (agent_name, ws, win_rate, brier, n, n, now),
                    )
            conn.commit()
            logger.info("Updated agent_stats for %d agents", len(agent_results))

    def get_agent_performance(self, window_size: int = 100) -> Dict[str, Dict]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM agent_stats
                WHERE window_size = ? AND regime_tag = 'all'
                """,
                (window_size,),
            ).fetchall()
            return {r["agent_name"]: dict(r) for r in rows}

    def get_expectancy_by_confidence(self, bins: List[Tuple[float, float]] = None) -> List[Dict]:
        bins = bins or [(0, 40), (40, 60), (60, 75), (75, 90), (90, 101)]
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT leader_confidence, leader_direction, actual_outcome, paper_pnl
                FROM signals
                WHERE actual_outcome IS NOT NULL AND leader_direction != 'WAIT'
                """
            ).fetchall()
        results = []
        for low, high in bins:
            bucket = [r for r in rows if low <= r["leader_confidence"] < high]
            if not bucket:
                results.append({"range": f"{low}-{high}", "n": 0, "win_rate": None, "avg_pnl": None})
                continue
            n = len(bucket)
            wins = sum(1 for r in bucket if r["leader_direction"] == r["actual_outcome"])
            avg_pnl = sum((r["paper_pnl"] or 0) for r in bucket) / n
            results.append({
                "range": f"{low}-{high}",
                "n": n,
                "win_rate": wins / n,
                "avg_pnl": avg_pnl,
            })
        return results

    def record_weight_change(self, agent_name: str, old_weight: float, new_weight: float, reason: str = ""):
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO weight_history (timestamp, agent_name, old_weight, new_weight, reason)
                VALUES (?, ?, ?, ?, ?)
                """,
                (time.time(), agent_name, old_weight, new_weight, reason),
            )
            conn.commit()

    def get_recent_signals(self, limit: int = 20) -> List[Dict]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM signals ORDER BY timestamp DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]

    def summary(self) -> Dict[str, Any]:
        with self._connect() as conn:
            total = conn.execute("SELECT COUNT(*) as c FROM signals").fetchone()["c"]
            settled = conn.execute("SELECT COUNT(*) as c FROM signals WHERE actual_outcome IS NOT NULL").fetchone()["c"]
            waits = conn.execute("SELECT COUNT(*) as c FROM signals WHERE leader_direction = 'WAIT'").fetchone()["c"]
        return {
            "total_signals": total,
            "settled": settled,
            "wait_rate": waits / total if total else 0,
            "agent_performance": self.get_agent_performance(100),
            "expectancy_by_confidence": self.get_expectancy_by_confidence(),
        }
