"""
SQLite PerformanceStore – signal history, agent stats, weight history.
Async via aiosqlite / SQLAlchemy.
"""
from __future__ import annotations
from pathlib import Path

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Float, Integer, Text, or_, select, func
from backend.config import settings
from backend.agents.chair_gates import (
    chair_bins_from_settled,
    decide_open_lock_grade,
    decide_open_wait_grade,
    known_official_market,
    is_btc_shadow_row,
    is_eth_shadow_row,
    is_shadow_row,
    shadow_row_kind,
    lock_time_strike,
    paper_stake_for_lock,
    ticker_asset,
)
from loguru import logger

# Displayed-slate reset for ETH chair + eth_shadow only. Fixed epoch so
# restarts do not keep wiping new Vitalik hits. Bot memory stays on disk.
ETH_DISPLAY_RESET_ID = "2026-08-16-eth-display-reset"
ETH_DISPLAY_RESET_AT = "2026-08-16T13:20:00+00:00"
try:
    from backend.learning.btc15m import (
        BTC_15M_DISPLAY_RESET_AT,
        BTC_15M_DISPLAY_RESET_ID,
        is_btc_15m_ticker,
        is_btc_1h_ticker,
        paper_lock_score_skip,
    )
except Exception:  # pragma: no cover
    BTC_15M_DISPLAY_RESET_ID = "2026-08-16-btc-15m-display-reset"
    BTC_15M_DISPLAY_RESET_AT = "2026-08-16T15:50:00+00:00"

    def is_btc_15m_ticker(ticker):  # type: ignore
        return str(ticker or "").upper().startswith("KXBTC15M")

    def is_btc_1h_ticker(ticker):  # type: ignore
        return str(ticker or "").upper().startswith("KXBTCD")

    def paper_lock_score_skip(**kwargs):  # type: ignore
        return None


def _json_field(raw: Any) -> Any:
    if raw is None or raw == "":
        return None
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return None


class Base(DeclarativeBase):
    pass


class SignalRecord(Base):
    __tablename__ = "signals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[str] = mapped_column(String(40))
    market_ticker: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    leader_direction: Mapped[str] = mapped_column(String(16))
    leader_confidence: Mapped[int] = mapped_column(Integer, default=0)
    agent_votes: Mapped[str] = mapped_column(Text, default="{}")
    features: Mapped[str] = mapped_column(Text, default="{}")
    actual_outcome: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    settled_at: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    paper_pnl: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class WeightHistory(Base):
    __tablename__ = "weight_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[str] = mapped_column(String(40))
    agent_name: Mapped[str] = mapped_column(String(40))
    old_weight: Mapped[float] = mapped_column(Float)
    new_weight: Mapped[float] = mapped_column(Float)
    reason: Mapped[str] = mapped_column(String(120))


class WindowCall(Base):
    """
    Graded Chair call (scalp path on Kalshi odds) or a closed-hour WAIT sample.
    Multiple calls allowed inside one 15m window.
    direction: UP | DOWN | UP_HOLD | DOWN_HOLD | WAIT
    WAIT samples are stored so the Chairs learn from hours they sat out.
    Locks grade on official Kalshi finish. WAIT paper P&L stays $0.
    """
    __tablename__ = "window_calls"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Non-unique: many scalp calls can share a ticker/window
    ticker: Mapped[str] = mapped_column(String(80), index=True)
    direction: Mapped[str] = mapped_column(String(16))  # UP | DOWN | UP_HOLD | DOWN_HOLD | WAIT
    confidence: Mapped[int] = mapped_column(Integer, default=0)
    entry_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    open_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # entry Kalshi side %
    close_time: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    called_at: Mapped[str] = mapped_column(String(40))
    actual_outcome: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    settled_at: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    correct: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1 / 0
    exit_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # peak Kalshi side %
    # Path-grade metadata (nullable for legacy rows)
    win_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Kalshi pts target
    path_move_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    settle_reason: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    paper_stake: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    paper_pnl: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    paper_side: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)  # BUY_YES | BUY_NO
    regime_key: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    asset: Mapped[Optional[str]] = mapped_column(String(8), nullable=True, index=True)  # btc | eth
    floor_strike: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # exact locked strike
    p_finish: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ev_cents: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    y_finish: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # official UP/DOWN
    shadow: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1 = ETH/BTC shadow pick
    vetoed: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1 = BTC-impulse veto
    side_ask: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # ask ¢ at pick time
    wait_reason: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    seat_split: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    book_depth: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    would_lock_if_strict: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)



class ManualTrade(Base):
    """
    User-entered paper tracker (not auto Chair fills).
    Like a simple spreadsheet: side, stake, returned, pnl.
    """
    __tablename__ = "manual_trades"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    side: Mapped[str] = mapped_column(String(16))  # UP | DOWN
    stake: Mapped[float] = mapped_column(Float, default=0.0)
    returned: Mapped[float] = mapped_column(Float, default=0.0)  # cash back (0 if total loss)
    pnl: Mapped[float] = mapped_column(Float, default=0.0)  # returned - stake
    note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    traded_at: Mapped[str] = mapped_column(String(40), index=True)  # ISO UTC
    created_at: Mapped[str] = mapped_column(String(40))


class PerformanceStore:
    def __init__(self):
        self.engine = create_async_engine(settings.DATABASE_URL, echo=False)
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)

    async def init(self):
        # create_all only — never DROP, truncate, or rewrite council.db / brain.
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            # Best-effort add new columns / drop unique on ticker for multi-call scalp mode
            for stmt in (
                "ALTER TABLE window_calls ADD COLUMN win_pct FLOAT",
                "ALTER TABLE window_calls ADD COLUMN path_move_pct FLOAT",
                "ALTER TABLE window_calls ADD COLUMN settle_reason VARCHAR(32)",
                "ALTER TABLE window_calls ADD COLUMN paper_stake FLOAT",
                "ALTER TABLE window_calls ADD COLUMN paper_pnl FLOAT",
                "ALTER TABLE window_calls ADD COLUMN paper_side VARCHAR(16)",
                "ALTER TABLE window_calls ADD COLUMN regime_key VARCHAR(32)",
                "ALTER TABLE window_calls ADD COLUMN asset VARCHAR(8)",
                "ALTER TABLE window_calls ADD COLUMN floor_strike FLOAT",
                "ALTER TABLE window_calls ADD COLUMN p_finish FLOAT",
                "ALTER TABLE window_calls ADD COLUMN ev_cents FLOAT",
                "ALTER TABLE window_calls ADD COLUMN y_finish VARCHAR(10)",
                "ALTER TABLE window_calls ADD COLUMN shadow INTEGER",
                "ALTER TABLE window_calls ADD COLUMN vetoed INTEGER",
                "ALTER TABLE window_calls ADD COLUMN side_ask FLOAT",
                "ALTER TABLE window_calls ADD COLUMN wait_reason VARCHAR(40)",
                "ALTER TABLE window_calls ADD COLUMN seat_split TEXT",
                "ALTER TABLE window_calls ADD COLUMN book_depth TEXT",
                "ALTER TABLE window_calls ADD COLUMN would_lock_if_strict INTEGER",
            ):
                try:
                    await conn.exec_driver_sql(stmt)
                except Exception:
                    pass
        logger.info("PerformanceStore initialized")

    async def log_signal(
        self,
        decision: Dict[str, Any],
        agent_signals: List[Any],
        market_ticker: str | None = None,
        entry_price: float | None = None,
        close_time: str | None = None,
        kalshi_target: float | None = None,
        up_pct: float | None = None,
        down_pct: float | None = None,
        asset: str | None = None,
    ):
        votes = {s.agent_name: s.to_dict() for s in agent_signals}
        rec = SignalRecord(
            timestamp=datetime.now(timezone.utc).isoformat(),
            market_ticker=market_ticker,
            leader_direction=decision["direction"],
            leader_confidence=decision["confidence"],
            agent_votes=json.dumps(votes),
            features=json.dumps({
                "score": decision.get("score"),
                "diversity": decision.get("diversity"),
                "entry_price": entry_price,
                "close_time": close_time,
                "kalshi_target": kalshi_target if kalshi_target is not None else decision.get("kalshi_target"),
                "up_pct": up_pct,
                "down_pct": down_pct,
                "p_finish": decision.get("p_finish"),
                "ev_cents": decision.get("ev_cents"),
            }),
        )
        async with self.Session() as session:
            session.add(rec)
            await session.commit()
            signal_id = rec.id

        # BTC 15m path fills (dual / scale / cut / flip). ETH stays one-call.
        path_fills = decision.get("path_fills") if isinstance(decision.get("path_fills"), list) else []
        if market_ticker and path_fills:
            lc = decision.get("locked_call") if isinstance(decision.get("locked_call"), dict) else {}
            await self.record_path_fills(
                ticker=market_ticker,
                fills=path_fills,
                close_time=close_time or (lc or {}).get("close_time"),
                entry_price=entry_price,
                confidence=int(decision.get("confidence") or 0),
                regime_key=decision.get("regime_key"),
                asset=asset,
                floor_strike=lock_time_strike(
                    ticker=market_ticker,
                    floor_strike=(
                        decision.get("floor_strike")
                        or (lc or {}).get("floor_strike")
                        or kalshi_target
                    ),
                ),
                p_finish=decision.get("p_finish") if decision.get("p_finish") is not None else (lc or {}).get("p_finish"),
                ev_cents=decision.get("ev_cents") if decision.get("ev_cents") is not None else (lc or {}).get("ev_cents"),
            )
            return signal_id

        # Record scalp path-call (full or 1/4 HOLD). SWAP grades underlying lean as full side.
        direction = decision.get("direction")
        grade_dir = direction
        if direction == "SWAP":
            lean = decision.get("lean")
            grade_dir = lean if lean in ("UP", "DOWN") else None
        if market_ticker and grade_dir in ("UP", "DOWN", "UP_HOLD", "DOWN_HOLD"):
            lc = decision.get("locked_call") if isinstance(decision.get("locked_call"), dict) else {}
            await self.record_window_call(
                ticker=market_ticker,
                direction=grade_dir,
                confidence=int(decision.get("confidence") or 0),
                entry_price=entry_price,
                close_time=close_time or (lc or {}).get("close_time"),
                up_pct=up_pct,
                down_pct=down_pct,
                regime_key=decision.get("regime_key"),
                asset=asset,
                floor_strike=lock_time_strike(
                    ticker=market_ticker,
                    floor_strike=(
                        decision.get("floor_strike")
                        or (lc or {}).get("floor_strike")
                        or kalshi_target
                    ),
                ),
                p_finish=decision.get("p_finish") if decision.get("p_finish") is not None else (lc or {}).get("p_finish"),
                ev_cents=decision.get("ev_cents") if decision.get("ev_cents") is not None else (lc or {}).get("ev_cents"),
            )

        return signal_id

    @staticmethod
    def _data_dir() -> Path:
        return Path(getattr(settings, "DATA_DIR", None) or "./data")

    @staticmethod
    def _is_eth_display_row(r: Any) -> bool:
        """ETH chair locks and eth_shadow rows that paint Vitalik's slate."""
        if is_eth_shadow_row(r):
            return True
        asset = (getattr(r, "asset", None) or ticker_asset(getattr(r, "ticker", None)) or "")
        return str(asset).lower() in ("eth", "ethereum")

    @staticmethod
    def _is_btc_1h_display_row(r: Any) -> bool:
        """Hourly KXBTCD rows — not the 15m BTC scorecard."""
        return is_btc_1h_ticker(getattr(r, "ticker", None))

    @staticmethod
    def _is_btc_15m_display_row(r: Any) -> bool:
        return is_btc_15m_ticker(getattr(r, "ticker", None))

    @staticmethod
    def _btc15m_windows_for_scorecard(rows: List[Any]) -> List[Any]:
        """One scorecard row per 15m window. Win = net paper P&L > 0."""
        from types import SimpleNamespace
        from backend.learning.btc15m_path import group_path_windows
        from backend.agents.chair_gates import is_shadow_row as _shadow

        usable = [r for r in rows if not _shadow(r)]
        windows = []
        for _key, legs, net in group_path_windows(usable):
            if abs(float(net or 0.0)) <= 1e-9:
                continue
            head = legs[0]
            win = float(net) > 0.0
            windows.append(SimpleNamespace(
                id=getattr(head, "id", None),
                ticker=getattr(head, "ticker", None),
                direction="UP" if win else "DOWN",
                actual_outcome="UP" if win else "DOWN",
                y_finish=getattr(head, "y_finish", None),
                correct=1 if win else 0,
                settle_reason="path_pnl",
                paper_pnl=round(float(net), 2),
                paper_stake=sum(float(getattr(x, "paper_stake", 0) or 0) for x in legs),
                paper_side=getattr(head, "paper_side", None),
                entry_price=getattr(head, "entry_price", None),
                open_price=getattr(head, "open_price", None),
                exit_price=getattr(head, "exit_price", None),
                path_move_pct=getattr(head, "path_move_pct", None),
                win_pct=getattr(head, "win_pct", None),
                called_at=getattr(head, "called_at", None),
                settled_at=getattr(head, "settled_at", None),
                close_time=getattr(head, "close_time", None),
                confidence=getattr(head, "confidence", 0),
                shadow=0,
                vetoed=0,
                side_ask=getattr(head, "side_ask", None),
                wait_reason=None,
                would_lock_if_strict=0,
                seat_split=None,
                book_depth=None,
                regime_key=getattr(head, "regime_key", None),
                p_finish=getattr(head, "p_finish", None),
                ev_cents=getattr(head, "ev_cents", None),
                floor_strike=getattr(head, "floor_strike", None),
                asset=getattr(head, "asset", "btc"),
            ))
        windows.sort(key=lambda r: (r.settled_at or r.called_at or "", r.id or 0))
        return windows

    @staticmethod
    def _counting_lock_clause():
        """Chair locks that count — ETH/BTC shadows are a parallel tape."""
        return or_(WindowCall.shadow.is_(None), WindowCall.shadow == 0)

    @staticmethod
    def _grade_side(direction: str) -> Optional[str]:
        if direction in ("UP", "UP_HOLD"):
            return "UP"
        if direction in ("DOWN", "DOWN_HOLD"):
            return "DOWN"
        return None

    @staticmethod
    def _win_pts(direction: str) -> float:
        if direction in ("UP_HOLD", "DOWN_HOLD"):
            return float(settings.PATH_WIN_PCT) * float(settings.HOLD_FRACTION)
        return float(settings.PATH_WIN_PCT)

    @staticmethod
    def _default_stake(direction: str) -> float:
        # Flat paper stake. Chair conf is not a size multiplier.
        return paper_stake_for_lock(direction, lifetime_n=0, chair_conf=None)

    @staticmethod
    def _paper_side(direction: str) -> str:
        if direction in ("UP", "UP_HOLD"):
            return "BUY_YES"
        return "BUY_NO"

    @classmethod
    def _compute_paper_pnl(
        cls,
        direction: str,
        correct: int,
        entry_side: float | None,
        stake: float,
        path_move_pct: float | None = None,
        settle_reason: str | None = None,
    ) -> float:
        """
        Paper P&L aligned with path-scalp grading (not full binary settlement).

        Path-scaled (default):
          Win:  stake * path_move_pts / entry_side
                e.g. entry 50, move +7 → +0.14 * stake
          Partial win: same formula with actual path_move
          Near-certain (90→100): stake * (100 - entry) / entry  (held to certainty)
          Loss: -stake

        Legacy binary (PAPER_USE_KALSHI_PAYOFF=True): win stake*(100-entry)/entry
        """
        entry = float(entry_side) if entry_side is not None else None
        move = float(path_move_pct) if path_move_pct is not None else None

        if correct != 1:
            return round(-abs(stake), 2)

        # Near-certain lock: treat like capturing remaining upside to ~100
        if settle_reason == "near_certain" and entry is not None and 1.0 < entry < 99.0:
            return round(stake * (100.0 - entry) / entry, 2)

        use_binary = bool(getattr(settings, "PAPER_USE_KALSHI_PAYOFF", False))
        path_scaled = bool(getattr(settings, "PAPER_PATH_SCALED", True))

        if path_scaled and not use_binary:
            if entry is not None and entry > 1.0 and move is not None and move > 0:
                # Cap move so paper $ stays realistic for the scalp target
                cap = float(getattr(settings, "PATH_WIN_PCT", 7.0))
                if direction in ("UP_HOLD", "DOWN_HOLD"):
                    cap = cap * float(getattr(settings, "HOLD_FRACTION", 0.25))
                # Allow a bit of overshoot credit up to 1.5× target
                m = min(move, cap * 1.5)
                return round(stake * (m / entry), 2)
            # Fallback flat fraction of stake
            return round(stake * 0.15, 2)

        # Legacy full binary payoff
        if entry is not None and 1.0 < entry < 99.0:
            return round(stake * (100.0 - entry) / entry, 2)
        return round(stake, 2)

    @staticmethod
    def _side_pct(side: str, up: float | None, down: float | None) -> float | None:
        if side == "UP":
            if up is not None:
                return float(up)
            if down is not None:
                return max(0.0, min(100.0, 100.0 - float(down)))
            return None
        if down is not None:
            return float(down)
        if up is not None:
            return max(0.0, min(100.0, 100.0 - float(up)))
        return None

    async def record_path_fills(
        self,
        *,
        ticker: str,
        fills: List[Dict[str, Any]],
        close_time: str | None = None,
        entry_price: float | None = None,
        confidence: int = 0,
        regime_key: str | None = None,
        asset: str | None = None,
        floor_strike: float | None = None,
        p_finish: float | None = None,
        ev_cents: float | None = None,
    ) -> None:
        """
        Persist 15m path fills. Both sides may stay open. No one-call cap.
        Cuts realize paper P&L now. Expiry marks leftover legs later.
        """
        if not ticker or not fills:
            return
        now_iso = datetime.now(timezone.utc).isoformat()
        floor_strike = lock_time_strike(ticker=ticker, floor_strike=floor_strike)
        async with self.Session() as session:
            for fill in fills:
                if not isinstance(fill, dict):
                    continue
                kind = str(fill.get("fill_kind") or fill.get("action") or "").lower()
                side = str(fill.get("side") or "").upper()
                if side not in ("UP", "DOWN"):
                    continue
                if kind in ("cut", "flip_close"):
                    result = await session.execute(
                        select(WindowCall)
                        .where(
                            WindowCall.ticker == ticker,
                            WindowCall.actual_outcome.is_(None),
                            WindowCall.direction.in_((side, f"{side}_HOLD")),
                            PerformanceStore._counting_lock_clause(),
                        )
                        .order_by(WindowCall.id.asc())
                        .limit(1)
                    )
                    row = result.scalar_one_or_none()
                    if row is None:
                        continue
                    row.actual_outcome = "PATH"
                    row.settle_reason = "path_cut" if kind == "cut" else "path_flip"
                    try:
                        row.paper_pnl = float(fill.get("paper_pnl"))
                    except (TypeError, ValueError):
                        row.paper_pnl = 0.0
                    try:
                        if fill.get("exit_cents") is not None:
                            row.exit_price = float(fill.get("exit_cents"))
                    except (TypeError, ValueError):
                        pass
                    row.settled_at = now_iso
                    row.correct = None
                    continue
                if kind not in ("open", "scale", "flip_open", "dual_open"):
                    continue
                if kind != "scale":
                    existing = (
                        await session.execute(
                            select(WindowCall)
                            .where(
                                WindowCall.ticker == ticker,
                                WindowCall.actual_outcome.is_(None),
                                WindowCall.direction.in_((side, f"{side}_HOLD")),
                                PerformanceStore._counting_lock_clause(),
                            )
                            .limit(1)
                        )
                    ).scalar_one_or_none()
                    if existing is not None:
                        continue
                try:
                    entry_side = float(fill.get("entry_cents"))
                except (TypeError, ValueError):
                    continue
                try:
                    stake = float(fill.get("stake") if fill.get("stake") is not None else self._default_stake(side))
                except (TypeError, ValueError):
                    stake = self._default_stake(side)
                reason = {
                    "dual_open": "path_dual",
                    "scale": "path_scale",
                    "flip_open": "path_flip",
                    "open": "path_open",
                }.get(kind)
                session.add(WindowCall(
                    ticker=ticker,
                    direction=side,
                    confidence=int(confidence or 0),
                    entry_price=entry_price,
                    open_price=entry_side,
                    close_time=close_time,
                    called_at=now_iso,
                    win_pct=self._win_pts(side),
                    path_move_pct=0.0,
                    exit_price=entry_side,
                    paper_stake=stake,
                    paper_side=self._paper_side(side),
                    regime_key=regime_key,
                    asset=(asset or "btc"),
                    floor_strike=float(floor_strike) if floor_strike is not None else None,
                    p_finish=float(p_finish) if p_finish is not None else None,
                    ev_cents=float(ev_cents) if ev_cents is not None else None,
                    settle_reason=reason,
                ))
            await session.commit()

    async def record_window_call(
        self,
        ticker: str,
        direction: str,
        confidence: int,
        entry_price: float | None = None,
        close_time: str | None = None,
        up_pct: float | None = None,
        down_pct: float | None = None,
        regime_key: str | None = None,
        asset: str | None = None,
        floor_strike: float | None = None,
        p_finish: float | None = None,
        ev_cents: float | None = None,
    ):
        """
        Open a path-graded scalp call (full or 1/4 HOLD).

        Circuit breaker: max MAX_CALLS_PER_WINDOW (default 1) graded rows — one-call protocol
        per ticker per window — matches Chair ENTRY + MID + FINAL budget.
        Same-side refresh of an open call does NOT consume a new slot.
        WAIT samples use record_wait_sample (they do not consume a lock slot).
        An open WAIT for this ticker is upgraded to a real lock.
        """
        side = self._grade_side(direction)
        if side is None:
            return
        entry_side = self._side_pct(side, up_pct, down_pct)
        if entry_side is None:
            return  # need Kalshi odds to open a graded call
        # Persist lock-time strike even when live Kalshi floor_strike is null.
        floor_strike = lock_time_strike(ticker=ticker, floor_strike=floor_strike)

        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        win_pts = self._win_pts(direction)
        max_per_window = int(getattr(settings, "MAX_CALLS_PER_WINDOW", 1))

        async with self.Session() as session:
            # Active open call for THIS ticker (newest unsettled)
            result = await session.execute(
                select(WindowCall)
                .where(
                    WindowCall.actual_outcome.is_(None),
                    WindowCall.ticker == ticker,
                    PerformanceStore._counting_lock_clause(),
                )
                .order_by(WindowCall.id.desc())
                .limit(1)
            )
            active = result.scalar_one_or_none()

            if active is not None:
                active_side = self._grade_side(active.direction)
                # Open WAIT for this hour upgrades to the first real lock.
                if str(active.direction or "").upper() == "WAIT" and side in ("UP", "DOWN"):
                    active.direction = direction
                    active.confidence = confidence
                    active.open_price = entry_side
                    active.exit_price = entry_side
                    active.path_move_pct = 0.0
                    active.win_pct = win_pts
                    active.paper_stake = self._default_stake(direction)
                    active.paper_side = self._paper_side(direction)
                    active.paper_pnl = None
                    active.wait_reason = None
                    if close_time:
                        active.close_time = close_time
                    if entry_price is not None:
                        active.entry_price = entry_price
                    if floor_strike is not None:
                        try:
                            active.floor_strike = float(floor_strike)
                        except (TypeError, ValueError):
                            pass
                    if p_finish is not None:
                        try:
                            active.p_finish = float(p_finish)
                        except (TypeError, ValueError):
                            pass
                    if ev_cents is not None:
                        try:
                            active.ev_cents = float(ev_cents)
                        except (TypeError, ValueError):
                            pass
                    if regime_key:
                        active.regime_key = regime_key
                    if asset:
                        active.asset = asset
                    await session.commit()
                    return
                # Same side still open → refresh; upgrade HOLD → full if confluence strengthened
                if active.direction == direction or active_side == side:
                    active.confidence = confidence
                    if close_time:
                        active.close_time = close_time
                    if entry_price is not None:
                        active.entry_price = entry_price
                    if floor_strike is not None:
                        try:
                            active.floor_strike = float(floor_strike)
                        except (TypeError, ValueError):
                            pass
                    elif getattr(active, "floor_strike", None) is None:
                        filled = lock_time_strike(ticker=ticker)
                        if filled is not None:
                            active.floor_strike = filled
                    if p_finish is not None:
                        try:
                            active.p_finish = float(p_finish)
                        except (TypeError, ValueError):
                            pass
                    if ev_cents is not None:
                        try:
                            active.ev_cents = float(ev_cents)
                        except (TypeError, ValueError):
                            pass
                    # Promote 1/4 HOLD → full UP/DOWN when Chair firms up (same side)
                    if direction in ("UP", "DOWN") and active.direction in ("UP_HOLD", "DOWN_HOLD"):
                        active.direction = direction
                        active.win_pct = self._win_pts(direction)
                    elif direction in ("UP_HOLD", "DOWN_HOLD") and active.direction in ("UP", "DOWN"):
                        # Already on full target — keep the stricter bar
                        pass
                    # path update happens in settle/update
                    await session.commit()
                    return
                # One-call protocol: never grade a mid-window flip as miss.
                # Keep the original open call until window finish.
                await session.commit()
                return
                # (unreachable legacy flip settle removed)
                active.actual_outcome = "MISS"
                active.correct = 0
                active.settled_at = now_iso
                active.settle_reason = "flipped"
                if active.win_pct is None:
                    active.win_pct = self._win_pts(active.direction)
                stake = float(active.paper_stake) if active.paper_stake is not None else self._default_stake(active.direction)
                active.paper_stake = stake
                if not active.paper_side:
                    active.paper_side = self._paper_side(active.direction)
                active.paper_pnl = self._compute_paper_pnl(active.direction, 0, active.open_price, stake, path_move_pct=active.path_move_pct, settle_reason="flipped")
                # Enforce flip cooldown: do not open the opposite call immediately
                try:
                    called = datetime.fromisoformat(active.called_at.replace("Z", "+00:00")) if active.called_at else None
                    flip_gap = float(getattr(settings, "FLIP_MIN_GAP_SEC", 150.0))
                    if called is not None and (now - called).total_seconds() < flip_gap:
                        await session.commit()
                        return
                except Exception:
                    pass

            # Debounce same-side re-entry
            result = await session.execute(
                select(WindowCall)
                .where(
                    WindowCall.direction == direction,
                    PerformanceStore._counting_lock_clause(),
                )
                .order_by(WindowCall.id.desc())
                .limit(1)
            )
            last_same = result.scalar_one_or_none()
            if last_same is not None and last_same.actual_outcome is None:
                await session.commit()
                return
            if last_same is not None and last_same.called_at:
                try:
                    called = datetime.fromisoformat(last_same.called_at.replace("Z", "+00:00"))
                    gap = (now - called).total_seconds()
                    min_gap = float(settings.MIN_CALL_REENTRY_SEC)
                    # After a path-hit win on same side, longer cooldown
                    if last_same.correct == 1:
                        min_gap = max(min_gap, float(getattr(settings, "POST_HIT_COOLDOWN_SEC", 90.0)))
                    # After a miss, also wait longer before retrying same side
                    elif last_same.correct == 0:
                        min_gap = max(min_gap, float(getattr(settings, "POST_MISS_PENALTY_SEC", 120.0)) * 0.5)
                    if gap < min_gap and last_same.actual_outcome is not None:
                        await session.commit()
                        return
                except Exception:
                    pass

            # Global post-miss: any recent miss raises the bar (skip weak HOLD spam)
            if direction in ("UP_HOLD", "DOWN_HOLD"):
                result = await session.execute(
                    select(WindowCall)
                    .where(WindowCall.correct == 0)
                    .order_by(WindowCall.id.desc())
                    .limit(1)
                )
                last_miss = result.scalar_one_or_none()
                if last_miss is not None and last_miss.settled_at:
                    try:
                        st = datetime.fromisoformat(last_miss.settled_at.replace("Z", "+00:00"))
                        if (now - st).total_seconds() < float(getattr(settings, "POST_MISS_PENALTY_SEC", 120.0)):
                            # Skip new HOLD right after a miss — need full confluence recovery
                            await session.commit()
                            return
                    except Exception:
                        pass

            # --- Circuit breaker: max graded calls per ticker / window ---
            # Count rows for this ticker tied to the same close_time (or recent if unknown).
            try:
                if close_time:
                    cnt_q = await session.execute(
                        select(func.count(WindowCall.id)).where(
                            WindowCall.ticker == ticker,
                            WindowCall.close_time == close_time,
                            PerformanceStore._counting_lock_clause(),
                        )
                    )
                else:
                    # Fallback: all calls for this ticker in the last ~20 minutes
                    cnt_q = await session.execute(
                        select(func.count(WindowCall.id)).where(
                            WindowCall.ticker == ticker,
                            PerformanceStore._counting_lock_clause(),
                        )
                    )
                n_calls = int(cnt_q.scalar_one() or 0)
                # If we just flipped an active call, that settled row still counts
                if n_calls >= max_per_window:
                    await session.commit()
                    return
            except Exception:
                pass

            stake = self._default_stake(direction)
            session.add(WindowCall(
                ticker=ticker,
                direction=direction,
                confidence=confidence,
                entry_price=entry_price,
                open_price=entry_side,  # entry Kalshi side %
                close_time=close_time,
                called_at=now_iso,
                win_pct=win_pts,
                path_move_pct=0.0,
                exit_price=entry_side,  # peak starts at entry
                paper_stake=stake,
                paper_side=self._paper_side(direction),
                regime_key=regime_key,
                asset=(asset or None),
                floor_strike=float(floor_strike) if floor_strike is not None else None,
                p_finish=float(p_finish) if p_finish is not None else None,
                ev_cents=float(ev_cents) if ev_cents is not None else None,
            ))
            await session.commit()

    async def record_wait_sample(
        self,
        ticker: str,
        close_time: str | None = None,
        wait_reason: str | None = None,
        seat_split: Any = None,
        book_depth: Any = None,
        would_lock_if_strict: bool = False,
        asset: str | None = None,
        confidence: int = 0,
        regime_key: str | None = None,
        up_pct: float | None = None,
        down_pct: float | None = None,
    ) -> bool:
        """
        Persist one WAIT sample per ticker/window so closed hours still train.

        Does not consume a lock slot. Paper stake/P&L stay 0.
        A real UP/DOWN lock for the same ticker wins — WAIT is not written over it.
        """
        if not ticker:
            return False
        now_iso = datetime.now(timezone.utc).isoformat()
        split_txt = None
        depth_txt = None
        try:
            if seat_split is not None:
                split_txt = json.dumps(seat_split)
        except Exception:
            split_txt = None
        try:
            if book_depth is not None:
                depth_txt = json.dumps(book_depth)
        except Exception:
            depth_txt = None
        entry_side = None
        try:
            if up_pct is not None:
                entry_side = float(up_pct)
        except (TypeError, ValueError):
            entry_side = None
        if entry_side is None:
            try:
                if down_pct is not None:
                    entry_side = max(0.0, min(100.0, 100.0 - float(down_pct)))
            except (TypeError, ValueError):
                entry_side = None

        async with self.Session() as session:
            result = await session.execute(
                select(WindowCall)
                .where(
                    WindowCall.actual_outcome.is_(None),
                    WindowCall.ticker == ticker,
                    PerformanceStore._counting_lock_clause(),
                )
                .order_by(WindowCall.id.desc())
                .limit(1)
            )
            active = result.scalar_one_or_none()
            if active is not None and self._grade_side(active.direction) in ("UP", "DOWN"):
                await session.commit()
                return False
            if active is not None and str(active.direction or "").upper() == "WAIT":
                active.confidence = int(confidence or 0)
                if close_time:
                    active.close_time = close_time
                if wait_reason:
                    active.wait_reason = str(wait_reason)[:40]
                if split_txt is not None:
                    active.seat_split = split_txt
                if depth_txt is not None:
                    active.book_depth = depth_txt
                active.would_lock_if_strict = 1 if would_lock_if_strict else 0
                active.paper_stake = 0.0
                active.paper_pnl = 0.0
                if entry_side is not None:
                    active.open_price = entry_side
                if regime_key:
                    active.regime_key = regime_key
                if asset:
                    active.asset = asset
                await session.commit()
                return False
            session.add(WindowCall(
                ticker=ticker,
                direction="WAIT",
                confidence=int(confidence or 0),
                entry_price=None,
                open_price=entry_side,
                close_time=close_time,
                called_at=now_iso,
                win_pct=None,
                path_move_pct=0.0,
                exit_price=entry_side,
                paper_stake=0.0,
                paper_pnl=0.0,
                paper_side=None,
                regime_key=regime_key,
                asset=(asset or None),
                wait_reason=str(wait_reason)[:40] if wait_reason else None,
                seat_split=split_txt,
                book_depth=depth_txt,
                would_lock_if_strict=1 if would_lock_if_strict else 0,
            ))
            await session.commit()
            return True

    async def _record_shadow_pick(
        self,
        ticker: str,
        direction: str,
        confidence: int,
        close_time: str | None = None,
        side_ask: float | None = None,
        floor_strike: float | None = None,
        vetoed: bool = False,
        asset: str = "eth",
    ) -> None:
        """One shadow pick per hour. Stake 0. Does not count as a Chair lock."""
        book = str(asset or "").strip().lower()
        if book in ("ethereum",):
            book = "eth"
        if book in ("bitcoin",):
            book = "btc"
        if book not in ("eth", "btc"):
            return
        side = self._grade_side(direction)
        if side is None or not ticker:
            return
        strike = lock_time_strike(ticker=ticker, floor_strike=floor_strike)
        ask = None
        try:
            if side_ask is not None:
                ask = float(side_ask)
        except (TypeError, ValueError):
            ask = None
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        async with self.Session() as session:
            q = select(WindowCall).where(
                WindowCall.actual_outcome.is_(None),
                WindowCall.shadow == 1,
                WindowCall.asset == book,
            )
            if close_time:
                q = q.where(WindowCall.close_time == close_time)
            else:
                q = q.where(WindowCall.ticker == ticker)
            q = q.order_by(WindowCall.id.desc()).limit(1)
            existing = (await session.execute(q)).scalar_one_or_none()
            if existing is not None:
                existing.direction = side
                existing.confidence = int(confidence or 0)
                existing.ticker = ticker
                existing.vetoed = 1 if vetoed else 0
                if ask is not None:
                    existing.side_ask = ask
                    existing.open_price = ask
                if strike is not None:
                    existing.floor_strike = strike
                if close_time:
                    existing.close_time = close_time
                existing.paper_stake = 0.0
                existing.asset = book
                await session.commit()
                return
            session.add(WindowCall(
                ticker=ticker,
                direction=side,
                confidence=int(confidence or 0),
                entry_price=None,
                open_price=ask,
                close_time=close_time,
                called_at=now_iso,
                win_pct=None,
                path_move_pct=0.0,
                exit_price=ask,
                paper_stake=0.0,
                paper_pnl=0.0,
                paper_side=self._paper_side(side),
                asset=book,
                floor_strike=strike,
                shadow=1,
                vetoed=1 if vetoed else 0,
                side_ask=ask,
            ))
            await session.commit()

    async def record_eth_shadow_pick(
        self,
        ticker: str,
        direction: str,
        confidence: int,
        close_time: str | None = None,
        side_ask: float | None = None,
        floor_strike: float | None = None,
        vetoed: bool = False,
        asset: str = "eth",
    ) -> None:
        """
        One ETH shadow pick per hour. Stake 0. Does not count as a Chair lock.
        A BTC-impulse veto is stored so we can grade whether the veto was right.
        """
        await self._record_shadow_pick(
            ticker=ticker,
            direction=direction,
            confidence=confidence,
            close_time=close_time,
            side_ask=side_ask,
            floor_strike=floor_strike,
            vetoed=vetoed,
            asset="eth",
        )

    async def record_btc_shadow_pick(
        self,
        ticker: str,
        direction: str,
        confidence: int,
        close_time: str | None = None,
        side_ask: float | None = None,
        floor_strike: float | None = None,
        vetoed: bool = False,
        asset: str = "btc",
    ) -> None:
        """
        One BTC WAIT-hour shadow pick. Stake 0. Does not count as a Chair lock.
        Never becomes a sized lock or Follower order.
        """
        await self._record_shadow_pick(
            ticker=ticker,
            direction=direction,
            confidence=confidence,
            close_time=close_time,
            side_ask=side_ask,
            floor_strike=floor_strike,
            vetoed=vetoed,
            asset="btc",
        )

    async def settle_expired_calls(
        self,
        current_price: float | None = None,
        up_pct: float | None = None,
        down_pct: float | None = None,
        floor_strike: float | None = None,
        asset: str | None = None,
        kalshi_results: Dict[str, Any] | None = None,
    ) -> int:
        """
        Finish-only grading for hit-rate / lifetime.

        A call is RIGHT only when the window has ended and the final
        market outcome matches the locked side (UP or DOWN).

        y_finish is written only from an official Kalshi result
        (yes→UP, no→DOWN) after the market is finalized/determined/settled.
        Later-hour spot is never used.
        """
        now = datetime.now(timezone.utc)
        settled_n = 0
        results = kalshi_results if isinstance(kalshi_results, dict) else {}
        want = (asset or "").strip().lower() or None

        async with self.Session() as session:
            result = await session.execute(
                select(WindowCall).where(WindowCall.actual_outcome.is_(None))
            )
            rows = result.scalars().all()
            for row in rows:
                inferred = ticker_asset(row.ticker)
                row_asset = (row.asset or inferred or "").lower()
                if want:
                    if inferred and inferred != want:
                        continue
                    if row_asset and row_asset != want:
                        continue
                    if not inferred and not row_asset:
                        continue
                side = self._grade_side(row.direction)
                if str(row.direction or "").upper() == "WAIT":
                    official = (
                        results.get(row.ticker)
                        or results.get(str(row.ticker or "").upper())
                        or results.get(row.id)
                        or results.get(str(row.id))
                        or known_official_market(row.ticker, row.id)
                    )
                    grade = decide_open_wait_grade(
                        ticker=row.ticker,
                        call_id=row.id,
                        close_time=row.close_time,
                        kalshi_result=official,
                        now=now,
                    )
                    if grade is None:
                        continue
                    y_finish = grade["y_finish"]
                    if grade.get("close_iso") and not row.close_time:
                        row.close_time = grade["close_iso"]
                    if getattr(row, "floor_strike", None) is None and grade.get("floor_strike") is not None:
                        row.floor_strike = grade["floor_strike"]
                    if not row.asset and grade.get("asset"):
                        row.asset = grade["asset"]
                    try:
                        row.y_finish = y_finish
                    except Exception:
                        pass
                    row.actual_outcome = "WAIT"
                    row.correct = None
                    row.paper_stake = 0.0
                    row.paper_pnl = 0.0
                    row.settled_at = now.isoformat()
                    row.settle_reason = grade.get("settle_reason") or "wait_finish"
                    settled_n += 1
                    continue
                if side is None:
                    continue

                # Track path diagnostics only (never settle early on path)
                entry_side = row.open_price
                cur_side = self._side_pct(side, up_pct, down_pct)
                if entry_side is not None and cur_side is not None:
                    try:
                        peak = row.exit_price if row.exit_price is not None else entry_side
                        peak = max(float(peak), float(cur_side))
                        row.exit_price = peak
                        row.path_move_pct = max(0.0, float(peak) - float(entry_side))
                    except (TypeError, ValueError):
                        pass

                official = (
                    results.get(row.ticker)
                    or results.get(str(row.ticker or "").upper())
                    or results.get(row.id)
                    or results.get(str(row.id))
                    or known_official_market(row.ticker, row.id)
                )
                # Persist missing lock-time strike (1062/1063 were null).
                # Identity only — y_finish still comes from official result.
                if getattr(row, "floor_strike", None) is None:
                    filled = lock_time_strike(ticker=row.ticker, kalshi_result=official)
                    if filled is not None:
                        row.floor_strike = filled
                # Hour-close only. Official Kalshi yes/no → y_finish.
                # Never current_price vs strike. Never invent an outcome.
                grade = decide_open_lock_grade(
                    ticker=row.ticker,
                    call_id=row.id,
                    close_time=row.close_time,
                    direction=row.direction,
                    kalshi_result=official,
                    now=now,
                )
                if grade is None:
                    continue
                y_finish = grade["y_finish"]
                if grade.get("close_iso") and not row.close_time:
                    row.close_time = grade["close_iso"]
                if getattr(row, "floor_strike", None) is None and grade.get("floor_strike") is not None:
                    row.floor_strike = grade["floor_strike"]
                if not row.asset and grade.get("asset"):
                    row.asset = grade["asset"]

                shadow = is_shadow_row(row) or bool(getattr(row, "shadow", 0))
                if shadow:
                    stake = 0.0
                    row.paper_stake = 0.0
                    row.paper_pnl = 0.0
                    row.shadow = 1
                else:
                    stake = float(row.paper_stake) if row.paper_stake is not None else self._default_stake(row.direction)
                    row.paper_stake = stake
                if not row.paper_side:
                    row.paper_side = self._paper_side(row.direction)

                matched = bool(grade.get("correct"))
                row.actual_outcome = y_finish
                try:
                    row.y_finish = y_finish
                except Exception:
                    pass
                skip = paper_lock_score_skip(
                    ticker=row.ticker,
                    open_price=row.open_price,
                    side_ask=getattr(row, "side_ask", None),
                    direction=row.direction,
                )
                if skip in ("chalk_skip", "band_skip", "no_entry_odds"):
                    # Official finish is stored. Not a training win or miss.
                    row.correct = None
                    row.settle_reason = skip
                    row.paper_pnl = 0.0
                    row.settled_at = now.isoformat()
                    settled_n += 1
                    continue
                if is_btc_15m_ticker(row.ticker) and not shadow:
                    # Path P&L: mark leftover legs at 100/0. Not a directional hit.
                    from backend.learning.btc15m_path import realized_pnl, settle_exit_cents
                    exit_px = settle_exit_cents(side, y_finish)
                    try:
                        entry = float(row.open_price) if row.open_price is not None else 50.0
                    except (TypeError, ValueError):
                        entry = 50.0
                    row.exit_price = exit_px
                    row.paper_pnl = realized_pnl(stake, entry, exit_px)
                    row.correct = None
                    row.settled_at = now.isoformat()
                    row.settle_reason = "path_pnl"
                    settled_n += 1
                    continue
                row.correct = 1 if matched else 0
                row.settled_at = now.isoformat()
                row.settle_reason = grade.get("settle_reason") or (
                    "finish_match" if matched else "finish_miss"
                )
                if not shadow:
                    try:
                        entry = float(row.open_price) if row.open_price is not None else 50.0
                        if matched and 1.0 < entry < 99.0:
                            row.paper_pnl = stake * ((100.0 / entry) - 1.0)
                        elif matched:
                            row.paper_pnl = stake
                        else:
                            row.paper_pnl = -stake
                    except Exception:
                        row.paper_pnl = stake if matched else -stake
                settled_n += 1

            await session.commit()
        if settled_n:
            logger.info(f"Settled {settled_n} call(s) [finish-only grade]")
        return settled_n


    def _row_to_log(self, r: WindowCall, status: str = "settled") -> Dict[str, Any]:
        return {
            "id": r.id,
            "ticker": r.ticker,
            "direction": r.direction,
            "outcome": r.actual_outcome,
            "y_finish": getattr(r, "y_finish", None) or r.actual_outcome,
            "correct": (bool(r.correct == 1) if r.correct is not None else None),
            "confidence": r.confidence,
            "entry": r.entry_price,
            "entry_side_pct": r.open_price,
            "peak_side_pct": r.exit_price,
            "win_pct": r.win_pct,
            "path_move_pct": r.path_move_pct,
            "settle_reason": r.settle_reason,
            "target": r.open_price,
            "exit": r.exit_price,
            "settled_at": r.settled_at,
            "called_at": r.called_at,
            "close_time": r.close_time,
            "status": status,
            "paper_stake": r.paper_stake,
            "paper_pnl": r.paper_pnl,
            "paper_side": r.paper_side,
            "regime_key": r.regime_key,
            "p_finish": getattr(r, "p_finish", None),
            "ev_cents": getattr(r, "ev_cents", None),
            "floor_strike": getattr(r, "floor_strike", None),
            "asset": (r.asset or ticker_asset(r.ticker)),
            "shadow": bool(getattr(r, "shadow", 0)),
            "vetoed": bool(getattr(r, "vetoed", 0)),
            "side_ask": getattr(r, "side_ask", None),
            "kind": shadow_row_kind(r) or ("wait" if str(r.direction or "").upper() == "WAIT" else "chair"),
            "wait_reason": getattr(r, "wait_reason", None),
            "would_lock_if_strict": bool(getattr(r, "would_lock_if_strict", 0)),
            "seat_split": _json_field(getattr(r, "seat_split", None)),
            "book_depth": _json_field(getattr(r, "book_depth", None)),
        }

    async def get_accuracy(self, asset: str | None = None) -> Dict[str, Any]:
        """
        Lifetime hit-rate for the Chair's directional calls (persisted in SQLite).
        WAIT excluded — only settled UP/DOWN window calls count.
        Includes rolling windows + full log so you can see if it needs fixing over time.
        """
        async with self.Session() as session:
            def _asset_clause(col):
                """BTC includes legacy NULL-asset rows; ETH is strict."""
                if not asset:
                    return None
                a = asset.lower()
                if a == "btc":
                    return (col == "btc") | (col.is_(None))
                return col == a

            filters = [WindowCall.actual_outcome.isnot(None)]
            ac = _asset_clause(WindowCall.asset)
            if ac is not None:
                filters.append(ac)
            settled = (
                await session.execute(
                    select(WindowCall)
                    .where(*filters)
                    .order_by(WindowCall.id.asc())
                )
            ).scalars().all()
            # Optional soft-clear: only count settles after hit_rate_reset mark
            try:
                hr_mark = await self._reset_mark("hit_rate")
                if hr_mark:
                    settled = [
                        r for r in settled
                        if (r.settled_at or r.called_at or "") >= hr_mark
                    ]
            except Exception:
                pass
            # ETH displayed chair / eth_shadow / 0–5 only. BTC 5–3 stays.
            # Does not delete window_calls or touch AdaptiveLearner JSON.
            try:
                eth_mark = await self._reset_mark("eth_display")
                if eth_mark:
                    settled = [
                        r for r in settled
                        if not self._is_eth_display_row(r)
                        or (r.settled_at or r.called_at or "") >= eth_mark
                    ]
            except Exception:
                pass
            # 15m BTC scorecard: hide 1H KXBTCD 5–3. ETH slate stays on its own mark.
            try:
                want = (asset or "").lower()
                if want in ("btc", "bitcoin"):
                    settled = [r for r in settled if self._is_btc_15m_display_row(r)]
                else:
                    settled = [r for r in settled if not self._is_btc_1h_display_row(r)]
            except Exception:
                pass
            want = (asset or "").lower()
            if want in ("btc", "bitcoin"):
                # Realized paper P&L windows — not finish_match directional hits.
                settled = self._btc15m_windows_for_scorecard(settled)
            else:
                # Finish-only: path / near_certain / partial / flipped do NOT count
                # Also accept settled rows with outcome but missing reason (legacy → treat as finish)
                FINISH = {"finish_match", "finish_miss"}
                settled = [
                    r for r in settled
                    if self._grade_side(r.direction) in ("UP", "DOWN")
                    and (r.actual_outcome in ("UP", "DOWN"))
                    and (
                        (r.settle_reason in FINISH)
                        or (not r.settle_reason)  # legacy graded rows
                    )
                ]
            all_finish = list(settled)
            # Chair locks that count. ETH shadows fill the ETH reliability bin only.
            # BTC shadows are a parallel paper bin — never mixed into sized-lock hit rate.
            settled = [r for r in all_finish if not is_shadow_row(r)]
            if (asset or "").lower() in ("eth", "ethereum"):
                reliability = [r for r in all_finish if not is_btc_shadow_row(r)]
            else:
                reliability = settled
            pending_filters = [
                WindowCall.actual_outcome.is_(None),
                PerformanceStore._counting_lock_clause(),
                WindowCall.direction.in_(("UP", "DOWN", "UP_HOLD", "DOWN_HOLD")),
            ]
            if ac is not None:
                pending_filters.append(ac)
            pending = (
                await session.execute(
                    select(func.count(WindowCall.id)).where(*pending_filters)
                )
            ).scalar() or 0
            total_signals = (
                await session.execute(select(func.count(SignalRecord.id)))
            ).scalar() or 0
            wait_signals = (
                await session.execute(
                    select(func.count(SignalRecord.id)).where(
                        SignalRecord.leader_direction == "WAIT"
                    )
                )
            ).scalar() or 0
            wait_q = [WindowCall.direction == "WAIT"]
            if ac is not None:
                wait_q.append(ac)
            wait_rows = (
                await session.execute(select(WindowCall).where(*wait_q))
            ).scalars().all()
            if (asset or "").lower() in ("btc", "bitcoin"):
                wait_rows = [r for r in wait_rows if self._is_btc_15m_display_row(r)]
            else:
                wait_rows = [r for r in wait_rows if not self._is_btc_1h_display_row(r)]
            open_q = [WindowCall.actual_outcome.is_(None)]
            if ac is not None:
                open_q.append(ac)
            open_rows = (
                await session.execute(
                    select(WindowCall)
                    .where(*open_q)
                    .order_by(WindowCall.id.desc())
                    .limit(12)
                )
            ).scalars().all()

        total = len(settled)
        correct = sum(1 for r in settled if r.correct == 1)
        wrong = total - correct
        accuracy_pct = round(100.0 * correct / total, 1) if total else None
        wait_n = len(wait_rows)
        wait_open_n = sum(1 for r in wait_rows if r.actual_outcome is None)
        wait_graded_n = sum(
            1 for r in wait_rows if getattr(r, "y_finish", None) in ("UP", "DOWN")
        )
        wait_rate = (
            round(wait_n / (wait_n + total), 3) if (wait_n + total) else None
        )
        wait_reasons: Dict[str, int] = {}
        for r in wait_rows:
            key = str(getattr(r, "wait_reason", None) or "other")
            wait_reasons[key] = wait_reasons.get(key, 0) + 1

        # Path tallies: entry Kalshi % and favorable peak move (peak − entry)
        def _path_pts(r):
            if r.path_move_pct is not None:
                return float(r.path_move_pct)
            if r.open_price is not None and r.exit_price is not None:
                return max(0.0, float(r.exit_price) - float(r.open_price))
            return None

        def _entry_pts(r):
            return float(r.open_price) if r.open_price is not None else None

        win_paths = [_path_pts(r) for r in settled if r.correct == 1 and _path_pts(r) is not None]
        lose_paths = [_path_pts(r) for r in settled if r.correct != 1 and _path_pts(r) is not None]
        all_paths = [_path_pts(r) for r in settled if _path_pts(r) is not None]
        entries = [_entry_pts(r) for r in settled if _entry_pts(r) is not None]
        win_entries = [_entry_pts(r) for r in settled if r.correct == 1 and _entry_pts(r) is not None]

        def _avg(xs):
            return round(sum(xs) / len(xs), 2) if xs else None

        avg_path_all = _avg(all_paths)
        avg_path_wins = _avg(win_paths)
        avg_path_losses = _avg(lose_paths)
        avg_entry_pct = _avg(entries)
        avg_entry_wins = _avg(win_entries)
        # Best / worst path on wins for context
        max_path_win = round(max(win_paths), 2) if win_paths else None
        min_path_win = round(min(win_paths), 2) if win_paths else None

        # Shadow book: paper EV in Kalshi percentage-points
        # Win: +path_move (or win_pct target); Miss: -win_pct (assumed stop at expiry)
        shadow_pts = 0.0
        shadow_n = 0
        for r in settled:
            target = float(r.win_pct or settings.PATH_WIN_PCT)
            if r.correct == 1:
                gained = float(r.path_move_pct) if r.path_move_pct is not None else target
                # HOLD calls are smaller notionally
                if r.direction in ("UP_HOLD", "DOWN_HOLD"):
                    gained = gained * 0.25
                shadow_pts += gained
            else:
                loss = target * (0.25 if r.direction in ("UP_HOLD", "DOWN_HOLD") else 1.0)
                shadow_pts -= loss
            shadow_n += 1
        shadow = {
            "n": shadow_n,
            "total_pts": round(shadow_pts, 2),
            "avg_pts_per_call": round(shadow_pts / shadow_n, 3) if shadow_n else None,
            "label": (
                f"{shadow_pts:+.1f} pts · {shadow_pts/shadow_n:+.2f}/call"
                if shadow_n else "0 pts · no settled"
            ),
        }

        # Newest-first for streaks / recent
        newest_first = list(reversed(settled))

        def window_stats(rows: list) -> Dict[str, Any]:
            n = len(rows)
            c = sum(1 for r in rows if r.correct == 1)
            return {
                "correct": c,
                "total": n,
                "wrong": n - c,
                "accuracy_pct": round(100.0 * c / n, 1) if n else None,
            }

        last_20 = window_stats(newest_first[:20])
        last_50 = window_stats(newest_first[:50])

        streak = 0
        for r in newest_first:
            if r.correct == 1:
                streak += 1
            else:
                break
        wrong_streak = 0
        for r in newest_first:
            if r.correct == 0:
                wrong_streak += 1
            else:
                break

        # Health verdict — enough sample + rate
        if total < 10:
            verdict = "COLLECTING"
            verdict_note = f"Need ~10 settled calls for a read ({total} so far)"
        elif accuracy_pct is not None and accuracy_pct >= 55:
            verdict = "HEALTHY"
            verdict_note = "Lifetime at or above 55% — edge looks alive"
        elif accuracy_pct is not None and accuracy_pct >= 48:
            verdict = "WATCH"
            verdict_note = "Near coin-flip — monitor last-20 vs lifetime"
        else:
            verdict = "NEEDS WORK"
            verdict_note = "Below 48% lifetime — review weights / agents / regime filters"

        # Drift: recent vs lifetime
        drift = None
        if last_20["accuracy_pct"] is not None and accuracy_pct is not None and last_20["total"] >= 8:
            drift = round(last_20["accuracy_pct"] - accuracy_pct, 1)

        # Lifetime log (newest first, capped for /api/state size; full via /api/lifetime)
        lifetime_log = [self._row_to_log(r) for r in newest_first[:100]]
        open_log = [self._row_to_log(r, status="open") for r in open_rows]
        recent_log = lifetime_log[:20]

        first_at = settled[0].settled_at or settled[0].called_at if settled else None
        last_at = newest_first[0].settled_at or newest_first[0].called_at if newest_first else None
        chair_bins = chair_bins_from_settled(
            reliability if (asset or "").lower() in ("eth", "ethereum") else settled
        )
        shadow_rows = [r for r in all_finish if is_eth_shadow_row(r)]
        shadow_hits = sum(1 for r in shadow_rows if r.correct == 1)
        btc_shadow_rows = [r for r in all_finish if is_btc_shadow_row(r)]
        btc_shadow_hits = sum(1 for r in btc_shadow_rows if r.correct == 1)

        return {
            # Lifetime primary stats
            "correct": correct,
            "total": total,
            "wrong": wrong,
            "accuracy_pct": accuracy_pct,
            "avg_path_pts": avg_path_all,
            "avg_path_wins": avg_path_wins,
            "avg_path_losses": avg_path_losses,
            "avg_entry_pct": avg_entry_pct,
            "avg_entry_wins": avg_entry_wins,
            "max_path_win": max_path_win,
            "min_path_win": min_path_win,
            "path_tally": {
                "avg_all": avg_path_all,
                "avg_wins": avg_path_wins,
                "avg_losses": avg_path_losses,
                "avg_entry": avg_entry_pct,
                "avg_entry_wins": avg_entry_wins,
                "max_win": max_path_win,
                "min_win": min_path_win,
                "n_with_path": len(all_paths),
                "n_wins_with_path": len(win_paths),
                "rule": "path_pts = peak favorable Kalshi side % − entry % while call was live",
            },
            "lifetime": {
                "correct": correct,
                "total": total,
                "wrong": wrong,
                "accuracy_pct": accuracy_pct,
                "avg_path_wins": avg_path_wins,
                "avg_entry_pct": avg_entry_pct,
                "first_settled_at": first_at,
                "last_settled_at": last_at,
            },
            "last_20": last_20,
            "last_50": last_50,
            "pending": int(pending),
            "open": int(pending),
            "calls_logged": int(pending) + int(total),
            "calls_settled": int(total),
            "reliability_n": len(reliability),
            "eth_shadow": {
                "n": len(shadow_rows),
                "hits": shadow_hits,
                "wrong": max(0, len(shadow_rows) - shadow_hits),
                "accuracy_pct": (
                    round(100.0 * shadow_hits / len(shadow_rows), 1) if shadow_rows else None
                ),
            },
            "btc_shadow": {
                "n": len(btc_shadow_rows),
                "hits": btc_shadow_hits,
                "wrong": max(0, len(btc_shadow_rows) - btc_shadow_hits),
                "accuracy_pct": (
                    round(100.0 * btc_shadow_hits / len(btc_shadow_rows), 1)
                    if btc_shadow_rows else None
                ),
            },
            "chair_bins": chair_bins,

            "streak": streak,
            "wrong_streak": wrong_streak,
            "total_signals": int(total_signals),
            "wait_signals": int(wait_signals),
            "wait_n": int(wait_n),
            "wait_open": int(wait_open_n),
            "wait_graded": int(wait_graded_n),
            "wait_rate": wait_rate,
            "wait_reasons": wait_reasons,
            "verdict": verdict,
            "verdict_note": verdict_note,
            "shadow": shadow,
            "drift_last20": drift,
            "recent": recent_log,
            "log": lifetime_log,
            "open": open_log,
            "label": (
                f"{correct}/{total} · {accuracy_pct}%"
                if total and accuracy_pct is not None
                else ("0/0 · —" if total == 0 else f"{correct}/{total}")
            ),
            "path_win_pct": float(settings.PATH_WIN_PCT),
            "hold_win_pct": float(settings.PATH_WIN_PCT) * float(settings.HOLD_FRACTION),
            "grade_rule": (
                f"RIGHT if Kalshi mid moves ≥{settings.PATH_WIN_PCT:g} pts (full path), "
                f"≥{getattr(settings, 'PATH_PARTIAL_PCT', 4):g} pts (partial), "
                f"or side ≥{getattr(settings, 'PATH_NEAR_CERTAIN_PCT', 90):g}% (near-certain). "
                f"HOLD targets scale by {settings.HOLD_FRACTION:g}. "
                f"Paper $ = path-scaled scalp, not full binary. BTC $ ignored."
            ),
            "path_partial_pct": float(getattr(settings, "PATH_PARTIAL_PCT", 4.0)),
            "path_near_certain_pct": float(getattr(settings, "PATH_NEAR_CERTAIN_PCT", 90.0)),
            "paper_path_scaled": bool(getattr(settings, "PAPER_PATH_SCALED", True)),
            "finish_only": True,
        }

    async def get_lifetime_log(self, limit: int = 500, offset: int = 0) -> Dict[str, Any]:
        """Full paginated lifetime call log for audit / export."""
        limit = max(1, min(int(limit), 2000))
        offset = max(0, int(offset))
        async with self.Session() as session:
            total = (
                await session.execute(
                    select(func.count(WindowCall.id)).where(WindowCall.actual_outcome.isnot(None))
                )
            ).scalar() or 0
            rows = (
                await session.execute(
                    select(WindowCall)
                    .where(WindowCall.actual_outcome.isnot(None))
                    .order_by(WindowCall.id.desc())
                    .offset(offset)
                    .limit(limit)
                )
            ).scalars().all()
            # Soft-clear life log display after admin clear
            try:
                ll_mark = await self._reset_mark("life_log")
                if ll_mark:
                    rows = [
                        r for r in rows
                        if (r.settled_at or r.called_at or "") >= ll_mark
                    ]
                    total = len(rows)  # approximate for cleared view
            except Exception:
                pass
            try:
                eth_mark = await self._reset_mark("eth_display")
                if eth_mark:
                    rows = [
                        r for r in rows
                        if not self._is_eth_display_row(r)
                        or (r.settled_at or r.called_at or "") >= eth_mark
                    ]
                    total = len(rows)
            except Exception:
                pass
            try:
                rows = [r for r in rows if not self._is_btc_1h_display_row(r)]
                total = len(rows)
            except Exception:
                pass
        acc = await self.get_accuracy()
        return {
            "total": total,
            "offset": offset,
            "limit": limit,
            "calls": [self._row_to_log(r) for r in rows],
            "summary": {
                "correct": acc["correct"],
                "wrong": acc["wrong"],
                "accuracy_pct": acc["accuracy_pct"],
                "verdict": acc["verdict"],
                "last_20": acc["last_20"],
                "lifetime": acc["lifetime"],
            },
        }


    async def get_paper_journal(self) -> Dict[str, Any]:
        """
        Paper call log with daily / weekly / monthly / yearly tallies (America/Chicago).
        """
        from zoneinfo import ZoneInfo
        from collections import defaultdict
        CT = ZoneInfo("America/Chicago")
        async with self.Session() as session:
            rows = (
                await session.execute(
                    select(WindowCall).order_by(WindowCall.id.desc()).limit(2000)
                )
            ).scalars().all()
        try:
            eth_mark = await self._reset_mark("eth_display")
            if eth_mark:
                rows = [
                    r for r in rows
                    if not self._is_eth_display_row(r)
                    or (r.settled_at or r.called_at or "") >= eth_mark
                ]
        except Exception:
            pass
        try:
            rows = [r for r in rows if not self._is_btc_1h_display_row(r)]
        except Exception:
            pass

        def to_ct(iso: str | None):
            if not iso:
                return None
            try:
                dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(CT)
            except Exception:
                return None

        now = datetime.now(CT)
        calls = []
        for r in rows:
            if r.direction not in ("UP", "DOWN", "UP_HOLD", "DOWN_HOLD"):
                continue
            when = to_ct(r.settled_at or r.called_at)
            stake = float(r.paper_stake) if r.paper_stake is not None else self._default_stake(r.direction)
            # Always recompute when path-scaled so old binary paper_pnl rows don't inflate the book
            if r.correct is not None and bool(getattr(settings, "PAPER_PATH_SCALED", True)):
                pnl = self._compute_paper_pnl(
                    r.direction, int(r.correct), r.open_price, stake,
                    path_move_pct=r.path_move_pct, settle_reason=r.settle_reason,
                )
            else:
                pnl = r.paper_pnl
                if pnl is None and r.correct is not None:
                    pnl = self._compute_paper_pnl(
                        r.direction, int(r.correct), r.open_price, stake,
                        path_move_pct=r.path_move_pct, settle_reason=r.settle_reason,
                    )
            calls.append({
                "id": r.id,
                "called_at": r.called_at,
                "settled_at": r.settled_at,
                "when_ct": when.isoformat() if when else None,
                "date": when.strftime("%Y-%m-%d") if when else None,
                "ticker": r.ticker,
                "direction": r.direction,
                "side": r.paper_side or self._paper_side(r.direction),
                "stake": stake,
                "pnl": round(float(pnl), 2) if pnl is not None else None,
                "correct": (bool(r.correct == 1) if r.correct is not None else None),
                "status": "open" if r.actual_outcome is None else ("win" if r.correct == 1 else "loss"),
                "entry_side_pct": r.open_price,
                "path_move_pct": r.path_move_pct,
                "confidence": r.confidence,
                "asset": (r.asset or ticker_asset(r.ticker)),
            })

        def bucket_sum(pred):
            subset = [c for c in calls if c["pnl"] is not None and c["date"] and pred(c)]
            wins = sum(1 for c in subset if c["correct"] is True)
            losses = sum(1 for c in subset if c["correct"] is False)
            pnl = round(sum(c["pnl"] for c in subset), 2)
            staked = round(sum(c["stake"] for c in subset), 2)
            return {
                "calls": len(subset),
                "wins": wins,
                "losses": losses,
                "pnl": pnl,
                "staked": staked,
                "win_rate": round(100.0 * wins / (wins + losses), 1) if (wins + losses) else None,
            }

        today = now.strftime("%Y-%m-%d")
        # ISO week key
        def week_key(d: datetime) -> str:
            iso = d.isocalendar()
            return f"{iso[0]}-W{iso[1]:02d}"

        this_week = week_key(now)
        this_month = now.strftime("%Y-%m")
        this_year = now.strftime("%Y")

        daily_map: Dict[str, Dict[str, float]] = defaultdict(lambda: {"pnl": 0.0, "calls": 0, "wins": 0, "losses": 0, "staked": 0.0})
        weekly_map: Dict[str, Dict[str, float]] = defaultdict(lambda: {"pnl": 0.0, "calls": 0, "wins": 0, "losses": 0, "staked": 0.0})
        monthly_map: Dict[str, Dict[str, float]] = defaultdict(lambda: {"pnl": 0.0, "calls": 0, "wins": 0, "losses": 0, "staked": 0.0})
        yearly_map: Dict[str, Dict[str, float]] = defaultdict(lambda: {"pnl": 0.0, "calls": 0, "wins": 0, "losses": 0, "staked": 0.0})

        for c in calls:
            if c["pnl"] is None or not c["when_ct"]:
                continue
            dt = to_ct(c["when_ct"])
            if not dt:
                continue
            d = dt.strftime("%Y-%m-%d")
            w = week_key(dt)
            m = dt.strftime("%Y-%m")
            y = dt.strftime("%Y")
            for mp, key in ((daily_map, d), (weekly_map, w), (monthly_map, m), (yearly_map, y)):
                mp[key]["pnl"] = round(mp[key]["pnl"] + c["pnl"], 2)
                mp[key]["calls"] += 1
                mp[key]["staked"] = round(mp[key]["staked"] + c["stake"], 2)
                if c["correct"] is True:
                    mp[key]["wins"] += 1
                elif c["correct"] is False:
                    mp[key]["losses"] += 1

        def map_to_list(mp):
            out = []
            for k in sorted(mp.keys(), reverse=True):
                row = dict(mp[k])
                row["key"] = k
                wl = row["wins"] + row["losses"]
                row["win_rate"] = round(100.0 * row["wins"] / wl, 1) if wl else None
                out.append(row)
            return out

        return {
            "default_stake": float(getattr(settings, "PAPER_STAKE_DEFAULT", 25.0)),
            "hold_stake": float(getattr(settings, "PAPER_STAKE_HOLD", 10.0)),
            "timezone": "America/Chicago",
            "summary": {
                "today": bucket_sum(lambda c: c["date"] == today),
                "week": bucket_sum(lambda c: c["when_ct"] and week_key(to_ct(c["when_ct"])) == this_week),
                "month": bucket_sum(lambda c: c["date"] and c["date"].startswith(this_month)),
                "year": bucket_sum(lambda c: c["date"] and c["date"].startswith(this_year)),
                "all_time": bucket_sum(lambda c: True),
            },
            "calendar": {
                "daily": map_to_list(daily_map)[:90],
                "weekly": map_to_list(weekly_map)[:52],
                "monthly": map_to_list(monthly_map)[:24],
                "yearly": map_to_list(yearly_map)[:10],
            },
            "calls": calls[:300],
            "open": [c for c in calls if c["status"] == "open"][:20],
        }

    async def paper_summary_by_asset(self, asset: str | None = None) -> Dict[str, Any]:
        """Finish-graded auto paper only. Open locks do not invent a −$25 P&L."""
        journal = await self.get_paper_journal()
        calls = list(journal.get("calls") or [])
        want = (asset or "").strip().lower() or None
        if want in ("bitcoin",):
            want = "btc"
        if want in ("ethereum",):
            want = "eth"
        if want:
            filtered = []
            for c in calls:
                inferred = ticker_asset(c.get("ticker"))
                row_a = (c.get("asset") or inferred or "").lower()
                if inferred and inferred != want:
                    continue
                if row_a and row_a != want:
                    continue
                if not inferred and not row_a:
                    continue
                filtered.append(c)
            calls = filtered
        settled = [
            c for c in calls
            if c.get("status") in ("win", "loss") and c.get("pnl") is not None
        ]
        wins = sum(1 for c in settled if c.get("correct") is True)
        losses = sum(1 for c in settled if c.get("correct") is False)
        pnl = round(sum(float(c.get("pnl") or 0) for c in settled), 2)
        return {
            "asset": want,
            "wins": wins,
            "losses": losses,
            "pnl": pnl if settled else 0.0,
            "recent": settled[:20],
            "open": [c for c in calls if c.get("status") == "open"][:20],
        }


    async def prune_old_window_calls(self, days: int = 90) -> int:
        """Delete settled window_calls older than `days`. Returns rows removed."""
        from datetime import datetime, timedelta, timezone
        cutoff = datetime.now(timezone.utc) - timedelta(days=int(days))
        cutoff_iso = cutoff.strftime("%Y-%m-%dT%H:%M:%S")
        try:
            async with self.Session() as session:
                result = await session.execute(
                    select(WindowCall).where(
                        WindowCall.settled_at.isnot(None),
                        WindowCall.settled_at < cutoff_iso,
                    )
                )
                rows = result.scalars().all()
                n = 0
                for r in rows:
                    await session.delete(r)
                    n += 1
                if n:
                    await session.commit()
                return n
        except Exception as e:
            logger.warning(f"prune_old_window_calls: {e}")
            return 0

    async def list_open_calls(self, asset: str | None = None) -> List[Dict[str, Any]]:
        """Open (unsettled) window calls for hour-close grading. Never deletes."""
        want = (asset or "").strip().lower() or None
        async with self.Session() as session:
            result = await session.execute(
                select(WindowCall).where(WindowCall.actual_outcome.is_(None))
            )
            rows = result.scalars().all()
        out: List[Dict[str, Any]] = []
        for r in rows:
            inferred = ticker_asset(r.ticker)
            row_asset = (r.asset or inferred or "").lower()
            if want:
                if inferred and inferred != want:
                    continue
                if row_asset and row_asset != want:
                    continue
                if not inferred and not row_asset:
                    continue
            out.append({
                "id": r.id,
                "ticker": r.ticker,
                "close_time": r.close_time,
                "floor_strike": getattr(r, "floor_strike", None),
                "asset": r.asset or inferred,
                "direction": r.direction,
                "shadow": bool(getattr(r, "shadow", 0)),
                "vetoed": bool(getattr(r, "vetoed", 0)),
            })
        return out

    async def recent_settled_calls(self, limit: int = 20, asset: str | None = None) -> List[Dict[str, Any]]:
        """Newest-first settled window calls, with agent votes when available."""
        async with self.Session() as session:
            result = await session.execute(
                select(WindowCall)
                .where(WindowCall.actual_outcome.isnot(None))
                .order_by(WindowCall.id.desc())
                .limit(max(int(limit) * 3, 40))
            )
            rows = result.scalars().all()
            if asset:
                want = asset.lower()
                rows = [
                    r for r in rows
                    if (r.asset or ticker_asset(r.ticker) or "").lower() == want
                ]
                if want in ("btc", "bitcoin"):
                    rows = [r for r in rows if is_btc_15m_ticker(r.ticker)]
            rows = rows[: max(1, int(limit))]
            out = []
            for r in rows:
                votes = None
                sig = (
                    await session.execute(
                        select(SignalRecord)
                        .where(SignalRecord.market_ticker == r.ticker)
                        .order_by(SignalRecord.id.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()
                if sig and sig.agent_votes:
                    try:
                        votes = json.loads(sig.agent_votes)
                    except Exception:
                        votes = None
                # Learner truth is official y_finish, not a later-hour spot.
                # WAIT never invents a finish from direction/correct.
                outcome = getattr(r, "y_finish", None)
                if str(r.direction or "").upper() == "WAIT":
                    if outcome not in ("UP", "DOWN"):
                        outcome = None
                elif outcome not in ("UP", "DOWN"):
                    outcome = r.actual_outcome if r.actual_outcome in ("UP", "DOWN") else None
                    if outcome not in ("UP", "DOWN"):
                        if r.correct == 1:
                            outcome = "UP" if r.direction in ("UP", "UP_HOLD") else "DOWN" if r.direction in ("DOWN", "DOWN_HOLD") else r.actual_outcome
                        else:
                            outcome = "DOWN" if r.direction in ("UP", "UP_HOLD") else "UP" if r.direction in ("DOWN", "DOWN_HOLD") else r.actual_outcome
                # Prefer stored regime; else derive from timestamps
                reg = r.regime_key
                if not reg:
                    try:
                        from backend.learning.regime_keys import regime_from_call
                        reg = regime_from_call(r.called_at, r.close_time)
                    except Exception:
                        reg = None
                out.append({
                    "id": r.id,
                    "ticker": r.ticker,
                    "direction": r.direction,
                    "confidence": r.confidence,
                    "actual_outcome": r.actual_outcome,
                    "y_finish": getattr(r, "y_finish", None) or r.actual_outcome,
                    "outcome": outcome,
                    "correct": r.correct,
                    "entry_price": r.entry_price,
                    "open_price": r.open_price,
                    "exit_price": r.exit_price,
                    "close_time": r.close_time,
                    "called_at": r.called_at,
                    "settled_at": r.settled_at,
                    "regime": reg,
                    "regime_key": reg,
                    "agent_votes": votes,
                    "settle_reason": r.settle_reason,
                    "path_move_pct": r.path_move_pct,
                    "paper_pnl": r.paper_pnl,
                    "p_finish": getattr(r, "p_finish", None),
                    "ev_cents": getattr(r, "ev_cents", None),
                    "floor_strike": getattr(r, "floor_strike", None),
                    "shadow": bool(getattr(r, "shadow", 0)),
                    "vetoed": bool(getattr(r, "vetoed", 0)),
                    "side_ask": getattr(r, "side_ask", None),
                    "kind": shadow_row_kind(r) or ("wait" if str(r.direction or "").upper() == "WAIT" else "chair"),
                    "wait_reason": getattr(r, "wait_reason", None),
                    "would_lock_if_strict": bool(getattr(r, "would_lock_if_strict", 0)),
                    "seat_split": _json_field(getattr(r, "seat_split", None)),
                    "book_depth": _json_field(getattr(r, "book_depth", None)),
                })
            return out

    async def chair_tape_24h(self, hours: int = 24) -> List[Dict[str, Any]]:
        """
        Read-only Chair paper tape for the last `hours`.
        Includes OPEN locks. Does not grade, settle, or invent a result.
        ETH/BTC shadow picks stay off this tape.
        """
        from datetime import timedelta

        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, int(hours)))
        cutoff_iso = cutoff.isoformat()
        async with self.Session() as session:
            rows = (
                await session.execute(
                    select(WindowCall)
                    .where(PerformanceStore._counting_lock_clause())
                    .order_by(WindowCall.id.desc())
                    .limit(400)
                )
            ).scalars().all()
        out: List[Dict[str, Any]] = []
        for r in rows:
            if is_shadow_row(r):
                continue
            open_row = r.actual_outcome is None
            stamp = r.called_at or r.close_time or r.settled_at or ""
            if not open_row and stamp and stamp < cutoff_iso:
                continue
            status = "open" if open_row else "settled"
            out.append(self._row_to_log(r, status=status))
        return out

    async def recent_weight_moves(self, limit: int = 40) -> List[Dict[str, Any]]:
        """Read-only recent seat weight changes (huddle / learn)."""
        async with self.Session() as session:
            rows = (
                await session.execute(
                    select(WeightHistory)
                    .order_by(WeightHistory.id.desc())
                    .limit(max(1, int(limit)))
                )
            ).scalars().all()
        return [
            {
                "agent": r.agent_name,
                "old": r.old_weight,
                "new": r.new_weight,
                "reason": r.reason,
                "at": r.timestamp,
            }
            for r in rows
        ]

    async def settle_signal(self, signal_id: int, outcome: str, paper_pnl: float | None = None):
        async with self.Session() as session:
            result = await session.execute(
                select(SignalRecord).where(SignalRecord.id == signal_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return
            row.actual_outcome = outcome
            row.settled_at = datetime.now(timezone.utc).isoformat()
            if paper_pnl is not None:
                row.paper_pnl = paper_pnl
            await session.commit()

    async def recent_signals(self, limit: int = 40) -> List[Dict[str, Any]]:
        async with self.Session() as session:
            result = await session.execute(
                select(SignalRecord).order_by(SignalRecord.id.desc()).limit(limit)
            )
            rows = result.scalars().all()
            return [
                {
                    "id": r.id,
                    "timestamp": r.timestamp,
                    "ticker": r.market_ticker,
                    "direction": r.leader_direction,
                    "confidence": r.leader_confidence,
                    "outcome": r.actual_outcome,
                    "paper_pnl": r.paper_pnl,
                }
                for r in rows
            ]

    async def log_weight_change(self, agent_name: str, old_weight: float, new_weight: float, reason: str = ""):
        async with self.Session() as session:
            session.add(WeightHistory(
                timestamp=datetime.now(timezone.utc).isoformat(),
                agent_name=agent_name,
                old_weight=old_weight,
                new_weight=new_weight,
                reason=reason[:120],
            ))
            await session.commit()



    async def add_manual_trade(
        self,
        side: str,
        stake: float,
        returned: float,
        note: str | None = None,
        traded_at: str | None = None,
    ) -> Dict[str, Any]:
        """User paper entry: bet amount in, cash back out."""
        side_u = (side or "").upper().strip()
        if side_u not in ("UP", "DOWN"):
            raise ValueError("side must be UP or DOWN")
        stake_f = max(0.0, float(stake))
        ret_f = max(0.0, float(returned))
        pnl = ret_f - stake_f
        now = datetime.now(timezone.utc).isoformat()
        when = traded_at or now
        async with self.Session() as session:
            row = ManualTrade(
                side=side_u,
                stake=stake_f,
                returned=ret_f,
                pnl=pnl,
                note=(note or "")[:200] or None,
                traded_at=when,
                created_at=now,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return {
                "id": row.id,
                "side": row.side,
                "stake": row.stake,
                "returned": row.returned,
                "pnl": row.pnl,
                "note": row.note,
                "traded_at": row.traded_at,
            }

    async def delete_manual_trade(self, trade_id: int) -> bool:
        async with self.Session() as session:
            result = await session.execute(
                select(ManualTrade).where(ManualTrade.id == int(trade_id))
            )
            row = result.scalar_one_or_none()
            if not row:
                return False
            await session.delete(row)
            await session.commit()
            return True

    async def get_manual_journal(self) -> Dict[str, Any]:
        """Spreadsheet-style totals for user paper tracker."""
        try:
            from zoneinfo import ZoneInfo
            ct = ZoneInfo("America/Chicago")
        except Exception:
            ct = timezone.utc

        async with self.Session() as session:
            result = await session.execute(
                select(ManualTrade).order_by(ManualTrade.id.desc()).limit(2000)
            )
            rows = list(result.scalars().all())

        def to_ct(iso: str | None):
            if not iso:
                return None
            try:
                dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
                return dt.astimezone(ct)
            except Exception:
                return None

        def day_key(d: datetime) -> str:
            return d.strftime("%Y-%m-%d")

        def week_key(d: datetime) -> str:
            iso = d.isocalendar()
            return f"{iso[0]}-W{iso[1]:02d}"

        def month_key(d: datetime) -> str:
            return d.strftime("%Y-%m")

        def year_key(d: datetime) -> str:
            return d.strftime("%Y")

        def bucket_sum(key_fn):
            buckets = {}
            for r in rows:
                d = to_ct(r.traded_at)
                if not d:
                    continue
                k = key_fn(d)
                b = buckets.setdefault(k, {"key": k, "n": 0, "stake": 0.0, "returned": 0.0, "pnl": 0.0, "wins": 0, "losses": 0})
                b["n"] += 1
                b["stake"] += float(r.stake or 0)
                b["returned"] += float(r.returned or 0)
                b["pnl"] += float(r.pnl or 0)
                if float(r.pnl or 0) > 0:
                    b["wins"] += 1
                elif float(r.pnl or 0) < 0:
                    b["losses"] += 1
            out = sorted(buckets.values(), key=lambda x: x["key"], reverse=True)
            for b in out:
                b["stake"] = round(b["stake"], 2)
                b["returned"] = round(b["returned"], 2)
                b["pnl"] = round(b["pnl"], 2)
            return out

        total_stake = sum(float(r.stake or 0) for r in rows)
        total_ret = sum(float(r.returned or 0) for r in rows)
        total_pnl = sum(float(r.pnl or 0) for r in rows)
        wins = sum(1 for r in rows if float(r.pnl or 0) > 0)
        losses = sum(1 for r in rows if float(r.pnl or 0) < 0)

        trades = []
        for r in rows[:200]:
            d = to_ct(r.traded_at)
            trades.append({
                "id": r.id,
                "side": r.side,
                "stake": round(float(r.stake or 0), 2),
                "returned": round(float(r.returned or 0), 2),
                "pnl": round(float(r.pnl or 0), 2),
                "note": r.note,
                "traded_at": r.traded_at,
                "when_ct": d.strftime("%m/%d %I:%M %p") if d else "—",
            })

        return {
            "mode": "manual",
            "summary": {
                "trades": len(rows),
                "wins": wins,
                "losses": losses,
                "stake": round(total_stake, 2),
                "returned": round(total_ret, 2),
                "pnl": round(total_pnl, 2),
            },
            "calendar": {
                "daily": bucket_sum(day_key),
                "weekly": bucket_sum(week_key),
                "monthly": bucket_sum(month_key),
                "yearly": bucket_sum(year_key),
            },
            "trades": trades,
        }

    async def export_brain_rows(self, limit: int = 5000) -> list:
        """All window calls (settled + open) for brain backup."""
        async with self.Session() as session:
            result = await session.execute(
                select(WindowCall).order_by(WindowCall.id.asc()).limit(limit)
            )
            rows = result.scalars().all()
            out = []
            for r in rows:
                out.append({
                    "ticker": r.ticker,
                    "direction": r.direction,
                    "confidence": r.confidence,
                    "entry_price": r.entry_price,
                    "open_price": r.open_price,
                    "close_time": r.close_time,
                    "called_at": r.called_at,
                    "settled_at": r.settled_at,
                    "actual_outcome": r.actual_outcome,
                    "correct": r.correct,
                    "win_pct": r.win_pct,
                    "path_move_pct": r.path_move_pct,
                    "exit_price": r.exit_price,
                    "paper_stake": r.paper_stake,
                    "paper_side": r.paper_side,
                    "paper_pnl": r.paper_pnl,
                    "settle_reason": r.settle_reason,
                    "regime_key": r.regime_key,
                    "asset": r.asset,
                    "floor_strike": getattr(r, "floor_strike", None),
                    "y_finish": getattr(r, "y_finish", None),
                    "shadow": getattr(r, "shadow", None),
                    "vetoed": getattr(r, "vetoed", None),
                    "side_ask": getattr(r, "side_ask", None),
                })
            return out

    async def import_brain_rows(self, rows: list, mode: str = "merge") -> dict:
        """
        Restore window calls from a brain export.
        mode=merge: append rows that don't collide on (ticker, called_at, direction)
        mode=replace: wipe WindowCall table first (dangerous)
        """
        if not rows:
            return {"imported": 0, "skipped": 0}
        imported = 0
        skipped = 0
        async with self.Session() as session:
            if mode == "replace":
                await session.execute(WindowCall.__table__.delete())
                await session.commit()
            existing = set()
            if mode == "merge":
                result = await session.execute(select(WindowCall))
                for r in result.scalars().all():
                    existing.add((r.ticker or "", r.called_at or "", r.direction or ""))
            for row in rows:
                key = (row.get("ticker") or "", row.get("called_at") or "", row.get("direction") or "")
                if mode == "merge" and key in existing:
                    skipped += 1
                    continue
                session.add(WindowCall(
                    ticker=row.get("ticker"),
                    direction=row.get("direction") or "WAIT",
                    confidence=int(row.get("confidence") or 0),
                    entry_price=row.get("entry_price"),
                    open_price=row.get("open_price"),
                    close_time=row.get("close_time"),
                    called_at=row.get("called_at"),
                    settled_at=row.get("settled_at"),
                    actual_outcome=row.get("actual_outcome"),
                    correct=row.get("correct"),
                    win_pct=row.get("win_pct"),
                    path_move_pct=row.get("path_move_pct"),
                    exit_price=row.get("exit_price"),
                    paper_stake=row.get("paper_stake"),
                    paper_side=row.get("paper_side"),
                    paper_pnl=row.get("paper_pnl"),
                    settle_reason=row.get("settle_reason"),
                    regime_key=row.get("regime_key"),
                    floor_strike=lock_time_strike(
                        ticker=row.get("ticker"),
                        floor_strike=row.get("floor_strike"),
                    ),
                    asset=row.get("asset"),
                    y_finish=row.get("y_finish"),
                    shadow=row.get("shadow"),
                    vetoed=row.get("vetoed"),
                    side_ask=row.get("side_ask"),
                ))
                imported += 1
                existing.add(key)
            await session.commit()
        return {"imported": imported, "skipped": skipped, "mode": mode}

    async def close(self):
        await self.engine.dispose()


    async def clear_hit_rate(self) -> Dict[str, Any]:
        """
        Reset accuracy counters derived from settled window_calls by marking
        them as 'archived' for hit-rate purposes WITHOUT deleting training rows.
        Implementation: move settled outcomes into a soft-reset by recording a
        hit_rate_reset watermark. Actual deletion of display counters only —
        AdaptiveLearner weights / pair affinities are untouched.
        """
        from datetime import datetime, timezone
        mark = datetime.now(timezone.utc).isoformat()
        # Soft approach: set a meta key; get_accuracy will only count settled after mark
        # Also hard-clear: null out correct/actual for display? Better: keep data but
        # store reset cursor so get_accuracy filters.
        try:
            DATA = self._data_dir()
            DATA.mkdir(parents=True, exist_ok=True)
            (DATA / "hit_rate_reset.json").write_text(
                json.dumps({"reset_at": mark, "cleared": "hit_rate"}), encoding="utf-8"
            )
        except Exception as e:
            logger.warning(f"clear_hit_rate mark failed: {e}")
        # Recompute so UI updates immediately
        acc = await self.get_accuracy()
        return {"ok": True, "reset_at": mark, "accuracy": acc}

    async def clear_life_log(self) -> Dict[str, Any]:
        """
        Clear the display history for Lifetime Log panel.
        Does NOT wipe training weights. Sets a life_log_reset watermark so
        get_lifetime_log / accuracy.log return empty until new settles arrive.
        """
        from datetime import datetime, timezone
        mark = datetime.now(timezone.utc).isoformat()
        try:
            DATA = self._data_dir()
            DATA.mkdir(parents=True, exist_ok=True)
            (DATA / "life_log_reset.json").write_text(
                json.dumps({"reset_at": mark, "cleared": "life_log"}), encoding="utf-8"
            )
        except Exception as e:
            logger.warning(f"clear_life_log mark failed: {e}")
        return {"ok": True, "reset_at": mark}

    async def ensure_eth_display_reset(self) -> Dict[str, Any]:
        """Wipe displayed ETH chair / 0–5 / eth_shadow only.

        Soft watermark under DATA_DIR. Does not delete window_calls.
        Does not touch council-learning-*.json, weights, or adaptive.
        BTC displayed hits stay. Paper only.
        """
        DATA = self._data_dir()
        DATA.mkdir(parents=True, exist_ok=True)
        p = DATA / "eth_display_reset.json"
        if p.exists():
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
                if raw.get("id") == ETH_DISPLAY_RESET_ID and raw.get("reset_at"):
                    return {
                        "ok": True,
                        "reset_at": raw.get("reset_at"),
                        "wrote": False,
                        "id": ETH_DISPLAY_RESET_ID,
                        "cleared": "eth_display",
                    }
            except Exception:
                pass
        payload = {
            "id": ETH_DISPLAY_RESET_ID,
            "reset_at": ETH_DISPLAY_RESET_AT,
            "cleared": "eth_display",
            "paper": True,
            "follower": False,
            "live": False,
        }
        p.write_text(json.dumps(payload), encoding="utf-8")
        logger.info("ETH displayed chair/shadow slate reset — BTC hits untouched, brain stays")
        return {
            "ok": True,
            "reset_at": ETH_DISPLAY_RESET_AT,
            "wrote": True,
            "id": ETH_DISPLAY_RESET_ID,
            "cleared": "eth_display",
        }

    async def ensure_btc_15m_display_reset(self) -> Dict[str, Any]:
        """Wipe displayed 1H BTC hits from the 15m scorecard.

        Soft watermark under DATA_DIR. Does not delete window_calls.
        Does not touch council-learning-eth.json or ETH displayed hits.
        Does not load 1H BTC weights onto the 15m brain.
        """
        DATA = self._data_dir()
        DATA.mkdir(parents=True, exist_ok=True)
        p = DATA / "btc_15m_display_reset.json"
        if p.exists():
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
                if raw.get("id") == BTC_15M_DISPLAY_RESET_ID and raw.get("reset_at"):
                    return {
                        "ok": True,
                        "reset_at": raw.get("reset_at"),
                        "wrote": False,
                        "id": BTC_15M_DISPLAY_RESET_ID,
                        "cleared": "btc_15m_display",
                    }
            except Exception:
                pass
        payload = {
            "id": BTC_15M_DISPLAY_RESET_ID,
            "reset_at": BTC_15M_DISPLAY_RESET_AT,
            "cleared": "btc_15m_display",
            "paper": True,
            "follower": False,
            "live": False,
        }
        p.write_text(json.dumps(payload), encoding="utf-8")
        logger.info("BTC 15m displayed slate reset — 1H 5–3 hidden, ETH slate/brain stay")
        return {
            "ok": True,
            "reset_at": BTC_15M_DISPLAY_RESET_AT,
            "wrote": True,
            "id": BTC_15M_DISPLAY_RESET_ID,
            "cleared": "btc_15m_display",
        }

    async def _reset_mark(self, kind: str) -> str | None:
        """Return ISO reset timestamp if a clear was requested for kind."""
        try:
            DATA = self._data_dir()
            names = {
                "hit_rate": "hit_rate_reset.json",
                "life_log": "life_log_reset.json",
                "eth_display": "eth_display_reset.json",
                "btc_15m_display": "btc_15m_display_reset.json",
            }
            p = DATA / names.get(str(kind or ""), "")
            if not p.name or not p.exists():
                return None
            raw = json.loads(p.read_text(encoding="utf-8"))
            return raw.get("reset_at")
        except Exception:
            return None

    async def export_excel_bytes(self) -> bytes:
        """Build an .xlsx of settled life log + hit rate summary + agent snapshot."""
        from io import BytesIO
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Alignment
        except ImportError:
            # Fallback CSV zip-like single sheet via pure python if openpyxl missing
            raise RuntimeError("openpyxl is required for Excel export")

        wb = Workbook()
        # Sheet 1: Life log
        ws = wb.active
        ws.title = "Life Log"
        headers = [
            "id", "ticker", "direction", "outcome", "correct", "confidence",
            "path_move_pct", "settle_reason", "regime_key", "called_at",
            "settled_at", "entry_side_pct", "peak_side_pct", "paper_pnl",
        ]
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="1a1a2e")

        life = await self.get_lifetime_log(limit=2000, offset=0)
        rows = (life.get("log") or life.get("rows") or []) if isinstance(life, dict) else []
        for r in rows:
            ws.append([
                r.get("id"), r.get("ticker"), r.get("direction"), r.get("outcome") or r.get("actual_outcome"),
                r.get("correct"), r.get("confidence"), r.get("path_move_pct"), r.get("settle_reason"),
                r.get("regime_key"), r.get("called_at"), r.get("settled_at"),
                r.get("entry_side_pct") or r.get("open_price"), r.get("peak_side_pct"),
                r.get("paper_pnl"),
            ])

        # Sheet 2: Hit rate
        ws2 = wb.create_sheet("Hit Rate")
        acc = await self.get_accuracy()
        ws2.append(["metric", "value"])
        for k in ("correct", "wrong", "total", "accuracy_pct", "pending", "streak", "wrong_streak", "verdict"):
            ws2.append([k, acc.get(k)])
        l20 = acc.get("last_20") or {}
        l50 = acc.get("last_50") or {}
        ws2.append(["last_20_pct", l20.get("accuracy_pct")])
        ws2.append(["last_50_pct", l50.get("accuracy_pct")])

        # Sheet 3: agents from last accuracy agent_stats if available
        try:
            stats = await self.update_agent_stats()
            ws3 = wb.create_sheet("Agents")
            ws3.append(["agent", "correct", "wrong", "total", "win_rate"])
            if isinstance(stats, dict):
                for name, st in sorted(stats.items()):
                    if not isinstance(st, dict):
                        continue
                    ws3.append([
                        name, st.get("correct"), st.get("wrong"),
                        st.get("total") or st.get("n"), st.get("win_rate"),
                    ])
        except Exception:
            pass

        buf = BytesIO()
        wb.save(buf)
        return buf.getvalue()


    async def update_agent_stats(self, limit: int = 200) -> Dict[str, Any]:
        """Compute rolling win-rate and simple Brier for directional signals."""
        async with self.Session() as session:
            result = await session.execute(
                select(SignalRecord)
                .where(SignalRecord.actual_outcome.isnot(None))
                .order_by(SignalRecord.id.desc())
                .limit(limit)
            )
            rows = result.scalars().all()

        from collections import defaultdict
        stats: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"correct": 0, "n": 0})
        for r in rows:
            if r.leader_direction not in ("UP", "DOWN"):
                continue
            try:
                votes = json.loads(r.agent_votes or "{}")
            except Exception:
                votes = {}
            for name, v in votes.items():
                d = v.get("direction") if isinstance(v, dict) else None
                if d not in ("UP", "DOWN"):
                    continue
                stats[name]["n"] += 1
                if d == r.actual_outcome:
                    stats[name]["correct"] += 1
        out = {}
        for name, s in stats.items():
            n = s["n"] or 1
            out[name] = {
                "correct": s["correct"],
                "n": s["n"],
                "win_rate": round(s["correct"] / n, 3),
            }
        return out

    async def get_expectancy_by_confidence(self) -> Dict[str, Any]:
        async with self.Session() as session:
            result = await session.execute(
                select(SignalRecord).where(
                    SignalRecord.actual_outcome.isnot(None),
                    SignalRecord.leader_direction != "WAIT",
                )
            )
            rows = result.scalars().all()
        buckets = {"50-59": [], "60-69": [], "70-79": [], "80+": []}
        for r in rows:
            c = r.leader_confidence or 0
            key = "80+" if c >= 80 else "70-79" if c >= 70 else "60-69" if c >= 60 else "50-59"
            buckets[key].append(1 if r.leader_direction == r.actual_outcome else 0)
        return {
            k: {
                "n": len(v),
                "hit_rate": round(100.0 * sum(v) / len(v), 1) if v else None,
            }
            for k, v in buckets.items()
        }

    async def summary(self) -> Dict[str, Any]:
        async with self.Session() as session:
            total = (await session.execute(select(func.count(SignalRecord.id)))).scalar() or 0
            settled = (
                await session.execute(
                    select(func.count(SignalRecord.id)).where(
                        SignalRecord.actual_outcome.isnot(None)
                    )
                )
            ).scalar() or 0
            waits = (
                await session.execute(
                    select(func.count(SignalRecord.id)).where(
                        SignalRecord.leader_direction == "WAIT"
                    )
                )
            ).scalar() or 0
        acc = await self.get_accuracy()
        return {
            "signals": total,
            "settled_signals": settled,
            "waits": waits,
            "accuracy": acc,
            "agent_stats": await self.update_agent_stats(),
            "expectancy": await self.get_expectancy_by_confidence(),
        }
