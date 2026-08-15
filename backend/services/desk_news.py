"""
Hour-moving news desk — display only.

Public RSS + economic calendar. Headlines never enter Chair lock math.
CoinGlass liq burst is optional garnish; a missing key does not block the tab.
"""
from __future__ import annotations

import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from loguru import logger

CT = ZoneInfo("America/Chicago")

RSS_FEEDS = (
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
    ("The Block", "https://www.theblock.co/rss.xml"),
    ("Reuters", "https://feeds.reuters.com/reuters/businessNews"),
)

FF_CALENDAR = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

KEEP_RE = re.compile(
    r"\b(bitcoin|btc|ethereum|ether|\beth\b|fomc|cpi|nfp|payroll|non[- ]farm|"
    r"etf|outage|hack|exploit|liquidat|fed\b|federal reserve|pce|sec\b|"
    r"spot etf|exchange halt|binance|coinbase|kraken)\b",
    re.I,
)
JUNK_RE = re.compile(
    r"\b(shiba|doge|pepe|memecoin|airdrop|presale|coin of the day|nft drop)\b",
    re.I,
)
MACRO_RE = re.compile(
    r"\b(fomc|cpi|nfp|non[- ]farm|payroll|pce|gdp|unemployment|fed |federal reserve|"
    r"interest rate|fomc minutes|core cpi|ppi)\b",
    re.I,
)

_CACHE: Dict[str, Any] = {"at": 0.0, "payload": None}
CACHE_S = 180.0


def _parse_when(raw: Any) -> Optional[datetime]:
    if not raw:
        return None
    if isinstance(raw, datetime):
        dt = raw
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    text = str(raw).strip()
    try:
        return parsedate_to_datetime(text)
    except Exception:
        pass
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def headline_is_hour_relevant(title: str, source: str = "") -> bool:
    blob = f"{title} {source}"
    if JUNK_RE.search(blob) and not KEEP_RE.search(title):
        return False
    return bool(KEEP_RE.search(blob))


def is_stale(published: Optional[datetime], now: Optional[datetime] = None, hours: float = 6.0) -> bool:
    if published is None:
        return True
    n = now or datetime.now(timezone.utc)
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    return (n - published) > timedelta(hours=hours)


def heat_in_current_hour(published: Optional[datetime], close_time: Any) -> bool:
    """True if the headline landed inside the current Kalshi hour."""
    pub = _parse_when(published) if not isinstance(published, datetime) else published
    close = _parse_when(close_time)
    if pub is None or close is None:
        return False
    start = close - timedelta(hours=1)
    if pub.tzinfo is None:
        pub = pub.replace(tzinfo=timezone.utc)
    if close.tzinfo is None:
        close = close.replace(tzinfo=timezone.utc)
    return start <= pub <= close


def time_to_print_ct(when: datetime, now: Optional[datetime] = None) -> str:
    n = (now or datetime.now(timezone.utc)).astimezone(CT)
    local = when.astimezone(CT) if when.tzinfo else when.replace(tzinfo=timezone.utc).astimezone(CT)
    delta = local - n
    secs = int(delta.total_seconds())
    if secs <= 0:
        ago = abs(secs)
        if ago < 3600:
            return f"{ago // 60}m ago CT"
        return f"{ago // 3600}h ago CT"
    if secs < 3600:
        return f"in {secs // 60}m CT"
    hours, rem = divmod(secs, 3600)
    mins = rem // 60
    if hours < 48:
        return f"in {hours}h {mins}m CT"
    days = hours // 24
    return f"in {days}d CT"


def format_ct(when: datetime) -> str:
    local = when.astimezone(CT)
    return local.strftime("%b %d %H:%M CT").replace(" 0", " ")


def next_nfp(now: Optional[datetime] = None) -> datetime:
    """First Friday of this or next month, 7:30 AM America/Chicago."""
    n = (now or datetime.now(timezone.utc)).astimezone(CT)
    year, month = n.year, n.month
    for _ in range(3):
        d = datetime(year, month, 1, 7, 30, tzinfo=CT)
        # Friday = 4
        offset = (4 - d.weekday()) % 7
        first_fri = d + timedelta(days=offset)
        if first_fri > n:
            return first_fri
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
    return n + timedelta(days=30)


# Published 2026 FOMC dates (statement ~1:00 PM CT / 2:00 PM ET).
_FOMC_2026 = (
    (2026, 9, 16, 13, 0),
    (2026, 10, 28, 13, 0),
    (2026, 12, 9, 13, 0),
)


def fallback_macro_prints(now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    n = now or datetime.now(timezone.utc)
    out = []
    nfp = next_nfp(n)
    out.append({
        "title": "US Nonfarm Payrolls (NFP)",
        "when": nfp,
        "when_ct": format_ct(nfp),
        "eta": time_to_print_ct(nfp, n),
        "kind": "NFP",
        "source": "calendar",
    })
    for y, mo, d, h, mi in _FOMC_2026:
        dt = datetime(y, mo, d, h, mi, tzinfo=CT)
        if dt > n.astimezone(CT):
            out.append({
                "title": "FOMC rate decision",
                "when": dt,
                "when_ct": format_ct(dt),
                "eta": time_to_print_ct(dt, n),
                "kind": "FOMC",
                "source": "calendar",
            })
            break
    return out


def _parse_rss_items(xml_text: str, source: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return out
    items = list(root.iter("item"))
    if not items:
        # Atom
        ns = {"a": "http://www.w3.org/2005/Atom"}
        items = list(root.iter("{http://www.w3.org/2005/Atom}entry"))
        for el in items:
            title = (el.findtext("{http://www.w3.org/2005/Atom}title") or "").strip()
            updated = el.findtext("{http://www.w3.org/2005/Atom}updated") or el.findtext("{http://www.w3.org/2005/Atom}published")
            if title:
                out.append({"title": title, "source": source, "published": _parse_when(updated)})
        return out
    for el in items:
        title = (el.findtext("title") or "").strip()
        pub = el.findtext("pubDate") or el.findtext("published") or el.findtext("{http://purl.org/dc/elements/1.1/}date")
        if title:
            out.append({"title": title, "source": source, "published": _parse_when(pub)})
    return out


async def _http_get(url: str, timeout: float = 5.0) -> Optional[str]:
    try:
        import httpx
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            r = await client.get(url, headers={"User-Agent": "SatoshiCouncil-NewsDesk/1.0"})
            if r.status_code >= 400:
                return None
            return r.text
    except Exception as e:
        logger.debug(f"desk news fetch {url}: {e}")
        return None


def parse_ff_calendar(rows: Any, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    n = now or datetime.now(timezone.utc)
    out: List[Dict[str, Any]] = []
    if not isinstance(rows, list):
        return out
    for row in rows:
        if not isinstance(row, dict):
            continue
        country = str(row.get("country") or row.get("currency") or "").upper()
        if country not in ("USD", "US", "UNITED STATES"):
            continue
        title = str(row.get("title") or row.get("event") or "").strip()
        if not title or not MACRO_RE.search(title):
            continue
        impact = str(row.get("impact") or row.get("importance") or "").lower()
        if impact and impact not in ("high", "medium", "3", "2", "red", "orange"):
            # still keep FOMC/CPI/NFP even if impact missing
            if not re.search(r"fomc|cpi|nfp|payroll|non[- ]farm|pce", title, re.I):
                continue
        when = _parse_when(row.get("date") or row.get("datetime") or row.get("time"))
        if when is None:
            continue
        if when < n - timedelta(hours=2):
            continue
        kind = "MACRO"
        if re.search(r"fomc|rate decision|fed", title, re.I):
            kind = "FOMC"
        elif re.search(r"\bcpi\b", title, re.I):
            kind = "CPI"
        elif re.search(r"nfp|payroll|non[- ]farm", title, re.I):
            kind = "NFP"
        out.append({
            "title": title,
            "when": when,
            "when_ct": format_ct(when),
            "eta": time_to_print_ct(when, n),
            "kind": kind,
            "source": "calendar",
        })
    out.sort(key=lambda e: e["when"])
    return out[:8]


def liq_burst_line(snap: Dict[str, Any] | None) -> Optional[str]:
    if not isinstance(snap, dict):
        return None
    lng = snap.get("liq_long_usd")
    sht = snap.get("liq_short_usd")
    try:
        total = float(lng or 0) + float(sht or 0)
    except (TypeError, ValueError):
        return None
    if total < 40_000_000:
        return None
    side = "longs" if float(lng or 0) > float(sht or 0) else "shorts"
    usd = total / 1_000_000.0
    return f"Liq burst · ${usd:.0f}M {side} in the last hour"


async def fetch_news_desk(
    *,
    hour_close: Any = None,
    liq_snap: Dict[str, Any] | None = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    n = now or datetime.now(timezone.utc)
    cached = _CACHE.get("payload")
    if cached and (time.time() - float(_CACHE.get("at") or 0)) < CACHE_S:
        payload = dict(cached)
        payload["breaking"] = [
            {**h, "stale": is_stale(h.get("published_dt"), n), "heat": heat_in_current_hour(h.get("published_dt"), hour_close)}
            for h in (payload.get("breaking") or [])
        ]
        return payload

    coming: List[Dict[str, Any]] = []
    cal_text = await _http_get(FF_CALENDAR, timeout=5.0)
    if cal_text:
        try:
            import json
            coming = parse_ff_calendar(json.loads(cal_text), n)
        except Exception as e:
            logger.debug(f"ff calendar parse: {e}")
    if not coming:
        coming = fallback_macro_prints(n)

    headlines: List[Dict[str, Any]] = []
    for source, url in RSS_FEEDS:
        body = await _http_get(url, timeout=5.0)
        if not body:
            continue
        for item in _parse_rss_items(body, source):
            title = item.get("title") or ""
            if not headline_is_hour_relevant(title, source):
                continue
            pub = item.get("published")
            headlines.append({
                "title": title,
                "source": source,
                "published_dt": pub,
                "when_ct": format_ct(pub) if isinstance(pub, datetime) else "—",
                "stale": is_stale(pub, n),
                "heat": heat_in_current_hour(pub, hour_close),
            })
    headlines.sort(key=lambda h: h.get("published_dt") or datetime(1970, 1, 1, tzinfo=timezone.utc), reverse=True)
    # Last few hours, newest first; keep a short rail
    recent = []
    for h in headlines:
        pub = h.get("published_dt")
        if pub and (n - pub) > timedelta(hours=18):
            continue
        recent.append(h)
        if len(recent) >= 12:
            break

    coming_out = []
    for e in coming:
        coming_out.append({
            "title": e["title"],
            "when_ct": e["when_ct"],
            "eta": e["eta"],
            "kind": e["kind"],
        })

    breaking_out = []
    for h in recent:
        pub = h.get("published_dt")
        breaking_out.append({
            "title": h.get("title"),
            "source": h.get("source"),
            "when_ct": h.get("when_ct"),
            "stale": h.get("stale"),
            "heat": h.get("heat"),
            "published": pub.isoformat() if isinstance(pub, datetime) else None,
        })
    payload = {
        "timezone": "America/Chicago",
        "coming_up": coming_out,
        "breaking": breaking_out,
        "liq_burst": liq_burst_line(liq_snap),
        "empty_coming": not coming_out,
        "empty_breaking": not recent,
        "note": "Display only. Headlines do not change Chair locks.",
    }
    # Keep datetimes on cache copy for stale/heat refresh
    cache_copy = dict(payload)
    cache_copy["breaking"] = recent
    _CACHE.update({"at": time.time(), "payload": cache_copy})
    return payload
