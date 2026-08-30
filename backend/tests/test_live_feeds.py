from backend.data.live_feeds import (
    combined_leftover,
    enrich_snap,
    put,
    quote_age_s,
    quote_stale,
    record_force,
    record_hl,
    record_quote,
    to_cents,
)


def test_to_cents_scales_unit_quotes():
    assert to_cents(0.42) == 42.0
    assert to_cents(42) == 42.0


def test_combined_leftover_positive():
    out = combined_leftover(0.40, 0.55)
    assert out["combined_ask_cents"] == 95.0
    assert out["leftover_cents"] == 5.0
    assert out["both_cheap"] is True
    assert out["no_edge"] is False


def test_combined_leftover_no_edge():
    out = combined_leftover(0.62, 0.41)
    assert out["leftover_cents"] == -3.0
    assert out["no_edge"] is True


def test_quote_stale():
    assert quote_stale(None) is False
    assert quote_stale(4.0) is False
    assert quote_stale(40.0) is True


def test_enrich_uses_fresher_quote_and_force():
    record_quote("btc", {"ticker": "KXBTC15M-X", "yes_ask": 0.41, "no_ask": 0.54, "source": "kalshi_rest"})
    record_force("btc", side="SELL", usd=2_400_000, px=110000)
    record_hl("btc", funding=0.0002, oi=12_000.0, mark=110000)
    snap = {
        "asset": "btc",
        "kalshi_market": {},
        "health": {},
        "kalshi_fetched_at": 1.0,
    }
    out = enrich_snap(snap)
    assert out["kalshi_yes_ask"] == 0.41
    assert out["leftover_cents"] == 5.0
    assert out["force_liq"]["force_long_usd"] >= 1
    assert out["hl_crowded"] is True
    assert out["health"]["quote_source"] == "kalshi_rest"
    assert quote_age_s(out, out.get("kalshi_fetched_at")) is not None


def test_missing_asks_fail_soft():
    out = combined_leftover(None, 0.5)
    assert out["leftover_cents"] is None
    put("eth", yes_ask=None)
    snap = enrich_snap({"asset": "eth", "kalshi_market": {}, "health": {}})
    assert "health" in snap
