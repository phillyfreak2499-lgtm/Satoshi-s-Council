# Council Roster

The desk is **Bitcoin only**: one fixed centre seat and four ranked advisors. Each advisor is a *leader* over a group of specialist agents; the advisor's stance is the synthesis of its group. SATOSHI is the sole decision-maker.

Source of truth: `backend/services/round_table.py` (`LEADER_DOMAINS`).

---

## Seats

| Callsign | Seat | Domain | Specialist agents (internal) |
|----------|------|--------|------------------------------|
| **SATOSHI** | Centre · rank 0 · final authority (fixed) | BTC higher-timeframe structure + final synthesis | `candle_btc`, `candle`, `strike`, `odds`, `quorum`, `session_tod` |
| **VITALIK** | Advisor | Ethereum flow & cross-major relative strength | `candle_eth`, `volume`, `spotlag`, `cheap` |
| **ARES** | Advisor | Momentum, trend continuity, and tape | `momentum`, `streak`, `orderflow`, `exhaust` |
| **RAIJIN** | Advisor · **veto** | Crowded positioning, funding, regime & volatility risk | `funding`, `oi_pressure`, `regime`, `volatility`, `whale`, `liq`, `panic` |
| **ORACLE** | Advisor · **veto** | Cross-checks, feed health & process adherence | `guardian`, `law`, `news` |

Notes:

- **SATOSHI is rank 0** and cannot be ranked, moved, or demoted. The centre seat is the gavel, not a competitor.
- The four advisors are **ranked by recent record** (recency-weighted). Rank #1 sits closest and is heard hardest; a wrong streak mutes an advisor until it earns the seat back.
- **VITALIK reads Ethereum as a signal** — ETH is not its own market, it is an input to relative-strength context for the Bitcoin call.
- **RAIJIN and ORACLE hold a veto.** A veto forces *Stand down* regardless of the vote — a protective brake, surfaced with its reason in the Provenance panel.

---

## Decision Output

SATOSHI issues one of:

**Accumulate · Reduce · Maintain · Stand down** — with a confidence and the reason behind it.

- A directional call (Accumulate / Reduce / Maintain) requires **confluence**: at least 3 of the 4 advisors on the same side, and no active veto.
- **Stand down** is a valid, tracked outcome — not a gap in the record. The desk sitting when the table has not earned a call is correct process.

Every call's inputs are auditable live via the **Provenance** panel (click SATOSHI's call), and the desk's confidence is measured against reality in the **Calibration** tab.

---

## Implementation Notes

- Internal agent keys are stable for weighting and learning logic; the roster above maps each specialist to its advisor (`AGENT_TO_LEADER`).
- Decision labels flow through `canonical_call` so historical rows written under older language still classify correctly.
- The Kalshi 15-minute market is read as a **lens** (`backend/services/kalshi15m.py`), reusing the same debate — no dedicated 15m bots.
