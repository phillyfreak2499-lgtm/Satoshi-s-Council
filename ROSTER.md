# Council Roster — Layout-Preserving Pivot

Keep every existing seat, bot image, rank badge, debate log entry point, and visual hierarchy.  
Only the **display names, short roles, and primary focus** change.

This mapping is designed for minimal frontend disruption while shifting the system from short-horizon Kalshi path trading to longer-horizon multi-coin research.

> **Note on scope.** The eight seats below are the *core decision seats* under the new doctrine.
> The running backend (`backend/agents/roster.py`) currently seats considerably more specialists —
> VOLT, CHAIN, STREAK, ODDS, STRIKE, CLOCK, WHALE, QUORUM, FADE, CHEAP, VEL, WIRE, CASCADE,
> EXHAUST, and LAW. Those seats are **not** removed by this pivot; they are retained, re-scoped,
> de-emphasized, or muted individually. The full live roster and each seat's disposition are
> tabulated in `README.md` → *Full live roster*. Nothing in this document should be read as an
> instruction to delete existing seats, images, or rank badges.
>
> **These are target assignments, not current code behavior.** Specifically, as of this writing:
> DRIFT (`momentum`) has no Solana input — SOL appears nowhere in the research pipeline;
> TAPE (`orderflow`) is still a Kalshi order-book reader, so it is Kalshi-dependent in the same way
> ODDS/STRIKE/CHEAP are; PULSE (`volume`) is asset-agnostic and runs on both tables rather than
> being the ETH seat (the ETH-specific agent is `candle_eth`, which maps to WICK); WARDEN
> (`guardian`) is feed-health only — there is no size or drawdown logic anywhere in the backend;
> and ORBIT (`regime`) is **not seated on the ETH table at all** (`ETH_CORE_AGENTS` excludes it).
> Additionally, the three seats marked for muting below currently carry ~30% of total base weight
> (`strike` 0.11, `cheap` 0.10, `odds` 0.09), with `strike` the second-highest-weighted specialist
> in the system. Muting them is a substantial reweighting job, not a flag flip.

---

## Active Seats

| Callsign | Role | Primary Focus | Notes |
|----------|------|---------------|-------|
| **CHAIR** | The Gavel | Final synthesis, ranking, overall confluence & risk posture | Remains the single synthesizer. Does not invent conviction. |
| **WICK** | BTC Structure | Bitcoin higher-timeframe structure, levels, pattern quality | Core BTC seat. Emphasize daily / 4H structure over 15m noise. |
| **PULSE** | ETH Flow | Ethereum volume, flow, and relative strength | ETH specialist. Volume confirmation and relative performance vs BTC. |
| **DRIFT** | Momentum Scout | Solana + cross-major momentum and trend strength | Momentum and trend quality across liquid majors. |
| **TAPE** | Multi-Coin Tape | Relative volume and cross-asset confirmation | Cross-sectional confirmation. Reduces single-asset tunnel vision. |
| **CARRY** | Crowding & Funding | Perp funding, open interest pressure, crowded positioning | Crowding and positioning risk across the set. |
| **ORBIT** | Regime Watch | Volatility regime, session context, risk-on / risk-off | Macro and regime filter. Influences how aggressive the Chair can be. |
| **WARDEN** | Risk Guardian | Feed health, process adherence, size & drawdown guardrails | System health + risk process. Can force Wait or reduce size recommendations. |

---

## Decision Output Standard

Every Chair output should follow this pattern when possible:

```text
[Decision] — [Confidence] — [Horizon]
Short synthesis of ranked agent agreement.
Key supporting agents: ...
Key dissenting or low-weight agents: ...
```

Examples:
- `Wait — High — n/a`  
  Insufficient confluence among top-ranked agents. Structure and momentum diverge.
- `Hold — Medium — days to weeks`  
  BTC structure and regime aligned; flow confirmation moderate.
- `Buy Zone — Medium-High — multi-day`  
  Ranked agents show improving momentum + acceptable crowding levels.

---

## Implementation Notes for Developers

- Internal agent keys (`candle`, `volume`, `momentum`, `orderflow`, `funding`, `regime`, `guardian`, `leader`, etc.) can remain stable for weighting and learning logic.
- Only `display_name` / callsign and the descriptive role text need to change in the UI layer.
- Decision enum / labels in the frontend and API responses should be updated to the new language (`Accumulate`, `Buy Zone`, `Hold`, `Reduce`, `Sell`, `Wait`).
- Kalshi-specific agents (odds, strike, pure path grading) should be muted, de-weighted, or removed from the primary research path.
- Dual-table support (BTC + ETH) can be extended naturally into a multi-coin view.

---

## Future Expansion (Optional)

Additional seats can be added later without breaking the visual language:
- Portfolio / Correlation seat
- On-chain / Realized value seat
- News / Sentiment seat (already partially present)
- Explicit multi-timeframe confluence seat

Keep the core 8-seat Round Table clean.
