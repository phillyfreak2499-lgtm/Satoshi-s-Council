"""
CF Benchmarks BRTI / ERTI — official Kalshi hourly settle print.

Kalshi hourly crypto settles on the 60-second average of CFB Real-Time Index
prints (one per second), not Coinbase, not Google, not a single Binance last.
A last-tick wick can be averaged away.

Spot rank for last-15 / P(finish):
  1) CFB RTI via Kalshi /cfbenchmarks (or 60 one-second RTI prints)
  2) data-api.binance.vision
  3) Coinbase public ticker (US cross-check)
api.binance.us is a separate book — never the same print as vision.
"""
from __future__ import annotations

import json
import time
from collections import deque
from typing import Any, Deque, Dict, Iterable, List, Optional, Sequence, Tuple

INDEX_BTC = "BRTI"
INDEX_ETH = "ETHUSD_RTI"
INDEX_ETH_ALIASES = ("ETHUSD_RTI", "ERTI")
RESEARCH_RANK = ("cfb", "vision", "coinbase")
SEPARATE_BOOKS = frozenset({"binance.us", "binance.com", "google", "us"})


def rti_id_for_asset(asset: Any) -> str:
    a = str(asset or "btc").strip().lower()
    if a.startswith("eth"):
        return INDEX_ETH
    return INDEX_BTC


def is_separate_book(source: Any) -> bool:
    text = str(source or "").strip().lower()
    if text in SEPARATE_BOOKS:
        return True
    if "binance.us" in text or text in ("binance_us", "us"):
        return True
    if "google" in text:
        return True
    return False


def research_source_label(source: Any) -> str:
    text = str(source or "").strip().lower()
    if text in ("cfb", "cfbenchmarks", "brti", "erti", "ethusd_rti") or "cfbenchmark" in text:
        return "cfb"
    if "binance.vision" in text or text == "vision":
        return "vision"
    if "coinbase" in text:
        return "coinbase"
    if is_separate_book(text):
        return "binance.us" if "us" in text or text == "us" else text
    return text or "unknown"


def _f(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        px = float(v)
    except (TypeError, ValueError):
        return None
    return px if px > 0 else None


def _ts(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        t = float(v)
    except (TypeError, ValueError):
        return None
    if t > 1e12:
        t = t / 1000.0
    return t if t > 0 else None


def _print_from_row(row: Any) -> Optional[Tuple[float, float]]:
    if row is None:
        return None
    if isinstance(row, (list, tuple)) and len(row) >= 2:
        ts, px = _ts(row[0]), _f(row[1])
        if ts is None:
            ts, px = _ts(row[1]), _f(row[0])
        if ts is not None and px is not None:
            return ts, px
        return None
    if not isinstance(row, dict):
        px = _f(row)
        return (time.time(), px) if px is not None else None
    px = _f(
        row.get("value")
        or row.get("v")
        or row.get("price")
        or row.get("index_value")
        or row.get("close")
    )
    ts = _ts(
        row.get("time")
        or row.get("t")
        or row.get("ts")
        or row.get("timestamp")
        or row.get("source_ts_ms")
        or row.get("received_at")
    )
    if px is None:
        return None
    return (ts if ts is not None else time.time()), px


def _avg_from_obj(obj: Any) -> Optional[Tuple[float, int]]:
    if not isinstance(obj, dict):
        px = _f(obj)
        return (px, 0) if px is not None else None
    px = _f(obj.get("value") or obj.get("v") or obj.get("avg") or obj.get("average"))
    if px is None:
        return None
    try:
        n = int(obj.get("window_size") or obj.get("n") or obj.get("count") or 0)
    except (TypeError, ValueError):
        n = 0
    return px, n


def _unwrap_payload(raw: Any) -> Any:
    if raw is None:
        return None
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        if text[:1] in ("{", "["):
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return None
        return raw
    if not isinstance(raw, dict):
        return raw
    if isinstance(raw.get("data"), (dict, list, str)):
        inner = raw["data"]
        if isinstance(inner, str):
            parsed = _unwrap_payload(inner)
            return parsed if parsed is not None else inner
        if isinstance(inner, dict) and (
            inner.get("payload") is not None
            or inner.get("value") is not None
            or inner.get("avg_60s_data") is not None
        ):
            return inner
        return inner
    if isinstance(raw.get("msg"), dict):
        return raw["msg"]
    if raw.get("payload") is not None:
        return raw["payload"] if not isinstance(raw.get("payload"), dict) or any(
            k in raw["payload"] for k in ("value", "values", "payload")
        ) else raw
    return raw


def parse_cfb_values(raw: Any, asset: Any = None) -> Dict[str, Any]:
    """
    Accept Kalshi /cfbenchmarks envelope, CFB REST payload, or WS value frame.
    Never invents a print.
    """
    empty = {
        "source": "cfb",
        "healthy": False,
        "index_id": rti_id_for_asset(asset),
        "rti": None,
        "avg_60s": None,
        "avg_60s_n": 0,
        "prints": [],
    }
    if raw is None:
        return dict(empty)
    body = _unwrap_payload(raw)
    prints: List[Tuple[float, float]] = []
    avg_60s = None
    avg_n = 0
    index_id = empty["index_id"]
    last = None

    def _ingest(obj: Any) -> None:
        nonlocal avg_60s, avg_n, index_id, last
        if obj is None:
            return
        if isinstance(obj, list):
            for row in obj:
                p = _print_from_row(row)
                if p:
                    prints.append(p)
            return
        if not isinstance(obj, dict):
            p = _print_from_row(obj)
            if p:
                prints.append(p)
            return
        idx = obj.get("index_id") or obj.get("id") or obj.get("index")
        if idx:
            index_id = str(idx)
        avg_obj = (
            obj.get("avg_60s_data")
            or obj.get("avg_60s")
            or obj.get("last_60s_windowed_average_15min")
        )
        got = _avg_from_obj(avg_obj) if avg_obj is not None else None
        if got:
            avg_60s, avg_n = got[0], max(avg_n, got[1])
        inner = obj.get("data")
        if isinstance(inner, str):
            parsed = _unwrap_payload(inner)
            if parsed is not None and parsed is not inner:
                _ingest(parsed)
        elif isinstance(inner, (dict, list)):
            _ingest(inner)
        payload = obj.get("payload")
        if payload is not None and payload is not obj:
            _ingest(payload)
        values = obj.get("values") or obj.get("history")
        if values is not None:
            _ingest(values)
        p = _print_from_row(obj)
        if p:
            prints.append(p)
            last = p[1]

    _ingest(body)
    if last is None and prints:
        last = prints[-1][1]
    if avg_60s is None and prints:
        avg_60s = average_rti_prints(prints, window_s=60.0)
        avg_n = len(prints)
    healthy = (avg_60s is not None and avg_60s > 0) or (last is not None and last > 0)
    return {
        "source": "cfb",
        "healthy": bool(healthy),
        "index_id": index_id,
        "rti": last,
        "avg_60s": avg_60s,
        "avg_60s_n": int(avg_n or 0),
        "prints": prints,
    }


def average_rti_prints(
    prints: Iterable[Any],
    window_s: float = 60.0,
    now: float | None = None,
) -> Optional[float]:
    """Mean of one-second RTI prints inside the trailing window. A wick averages away."""
    stamp = float(now) if now is not None else time.time()
    vals: List[float] = []
    for row in prints or []:
        p = _print_from_row(row)
        if p is None:
            continue
        ts, px = p
        if stamp - ts <= float(window_s) + 0.05:
            vals.append(px)
    if not vals:
        return None
    return sum(vals) / len(vals)


def last_tick_wick_averaged_away(
    last_tick: Any,
    avg_60s: Any,
    wick_bps: float = 8.0,
) -> bool:
    """True when a last print is a wick vs the 60s average (can be averaged away)."""
    last = _f(last_tick)
    avg = _f(avg_60s)
    if last is None or avg is None or avg <= 0:
        return False
    return abs(last - avg) / avg * 10_000.0 >= float(wick_bps)


class RtiWindow:
    """Trailing one-second RTI (or ranked fallback) prints for a 60s average."""

    def __init__(self, window_s: float = 60.0, maxlen: int = 120):
        self.window_s = float(window_s)
        self._prints: Deque[Tuple[float, float, str]] = deque(maxlen=max(8, int(maxlen)))

    def add(self, ts: Any, price: Any, source: str = "cfb") -> None:
        px = _f(price)
        t = _ts(ts) or time.time()
        if px is None:
            return
        src = research_source_label(source)
        if is_separate_book(src):
            return
        self._prints.append((t, px, src))
        self._trim(t)

    def _trim(self, now: float | None = None) -> None:
        stamp = float(now) if now is not None else time.time()
        cutoff = stamp - self.window_s - 1.0
        while self._prints and self._prints[0][0] < cutoff:
            self._prints.popleft()

    def stats(
        self,
        sources: Sequence[str] | None = None,
        now: float | None = None,
    ) -> Dict[str, Any]:
        self._trim(now)
        want = {research_source_label(s) for s in (sources or RESEARCH_RANK)}
        rows = [(t, px, src) for t, px, src in self._prints if src in want]
        if not rows:
            return {"avg": None, "n": 0, "span_s": 0.0, "last": None, "source": None}
        avg = sum(px for _, px, _ in rows) / len(rows)
        span = rows[-1][0] - rows[0][0]
        return {
            "avg": avg,
            "n": len(rows),
            "span_s": span,
            "last": rows[-1][1],
            "source": rows[-1][2],
        }

    def last(self, sources: Sequence[str] | None = None) -> Optional[float]:
        return self.stats(sources).get("last")


def pick_research_spot(
    *,
    cfb_avg_60s: Any = None,
    cfb_rti: Any = None,
    cfb_window: Dict[str, Any] | None = None,
    vision: Any = None,
    vision_window: Dict[str, Any] | None = None,
    coinbase: Any = None,
    coinbase_window: Dict[str, Any] | None = None,
    binance_us: Any = None,
    last_tick: Any = None,
    min_n: int = 15,
    min_span_s: float = 45.0,
) -> Dict[str, Any]:
    """
    Ranked research print for last-15 and P(finish).
    Prefers a 60s average. Never selects api.binance.us / Google / a lone last tick
    as the official settle reference.
    """
    _ = binance_us  # separate book — never the research print
    _ = last_tick  # a last-tick wick is not the settle
    out = {
        "spot": None,
        "source": None,
        "kind": None,
        "n": 0,
        "span_s": 0.0,
        "last_tick": _f(last_tick) or _f(cfb_rti) or _f(vision) or _f(coinbase),
        "us_book": _f(binance_us),
        "wick_averaged_away": False,
    }

    def _accept_avg(avg: Any, source: str, n: int = 0, span: float = 0.0, kind: str = "avg_60s"):
        px = _f(avg)
        if px is None:
            return False
        out["spot"] = px
        out["source"] = source
        out["kind"] = kind
        out["n"] = int(n)
        out["span_s"] = float(span)
        out["wick_averaged_away"] = last_tick_wick_averaged_away(out.get("last_tick"), px)
        return True

    if _accept_avg(cfb_avg_60s, "cfb", n=int((cfb_window or {}).get("n") or 60), span=60.0):
        return out
    for src, win, last in (
        ("cfb", cfb_window, cfb_rti),
        ("vision", vision_window, vision),
        ("coinbase", coinbase_window, coinbase),
    ):
        if not isinstance(win, dict):
            continue
        avg, n, span = win.get("avg"), int(win.get("n") or 0), float(win.get("span_s") or 0.0)
        if avg is None:
            continue
        if src == "cfb" and (n >= 8 or span >= 20.0):
            _accept_avg(avg, "cfb", n=n, span=span)
            return out
        if n >= int(min_n) and span >= float(min_span_s):
            _accept_avg(avg, src, n=n, span=span)
            return out
        if src == "cfb" and _f(last) is not None and n >= 1:
            # CFB last print is the RTI; still not a 60s average — keep looking
            continue
    # Ranked last print for display / agents — not last-15 official
    for src, px in (("cfb", cfb_rti), ("vision", vision), ("coinbase", coinbase)):
        got = _f(px)
        if got is not None:
            out["spot"] = None
            out["display_spot"] = got
            out["source"] = src
            out["kind"] = "last"
            return out
    return out


def last15_spot(research: Dict[str, Any] | None) -> Optional[float]:
    """Last-15 / P(finish) spot: 60s average only. A last tick is not enough."""
    if not isinstance(research, dict):
        return None
    if research.get("kind") != "avg_60s":
        return None
    return _f(research.get("spot"))
