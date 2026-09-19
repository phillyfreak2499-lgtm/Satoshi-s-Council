# OPENAI_SHADOW_V1

Prospective paper-only OpenAI research observer for the 15-minute Council.

## Question

Can a structured language-model analyst add incremental information beyond the same-time market and Council evidence at T−7:30?

This study is measurement first. It has **no authority** over SATOSHI, any seat, the learner, paper fills, promotion, sizing, wallets, orders, or real-money execution.

## Frozen protocol

- One capture per 15-minute window in the 450s-to-438s checkpoint.
- Input is frozen from the live server frame before settlement.
- The OpenAI packet includes Bitcoin, Kalshi market, derivatives, context and specialist-seat evidence.
- The packet builder does not accept Chair state, so the analyst cannot copy SATOSHI.
- Model: `gpt-5.6-terra` by default; override only with `OPENAI_SHADOW_MODEL`.
- Responses API, Structured Outputs, `store:false`, low reasoning.
- No web search, function tools, file search, computer use, account access or execution tools.
- Every successful row stores prompt version, model, input hash, exact input packet, normalized output, token usage and build SHA.
- Winner is never stored in the prediction row. Official result is joined later for scoring.

## Output

Every captured window must produce:

- `p_up` — probability target for Brier scoring.
- `side` — UP when `p_up >= 0.5`, otherwise DOWN.
- `conviction` — self-rated evidence strength; never treated as calibrated probability.
- `regime`.
- up to four strongest evidence labels.
- up to four contradictions.
- data quality: GOOD / DEGRADED / POOR.
- `would_abstain` — separate analysis cut; probability and direction remain scoreable.

## Setup

Server secret:

```
OPENAI_API_KEY=<project API key>
```

Optional model override:

```
OPENAI_SHADOW_MODEL=gpt-5.6-terra
```

If `OPENAI_API_KEY` is absent, the observer is dormant and the rest of the desk is unaffected.

## Evaluation

The public Lab scorecard reports:

- captured / graded windows,
- directional accuracy,
- Brier score vs same-time market probability,
- non-abstain accuracy,
- performance when SATOSHI was WAIT,
- coverage / missed checkpoints,
- cumulative API token usage.

No conclusion should be drawn from a small sample. A future change granting this study any influence requires a separate code path, explicit review, a new research-era boundary and new tests.
