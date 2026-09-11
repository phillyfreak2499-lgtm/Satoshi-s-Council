# Social / X media URLs (public HTTPS)

OpenTweet needs remote HTTPS media, not agent-local paths. The desk already
serves share PNGs — use these; no upload subsystem required.

## Seat portrait / intro card

```
GET https://satoshiscouncil.com/og/seat?id={SEAT_ID}
```

- `{SEAT_ID}` — uppercase roster id (`WICK`, `WARDEN`, `FADE`, …)
- Response: `image/png` (live seat card from the current frame)
- Cache: ~5 minutes

**Example (WARDEN):**
https://satoshiscouncil.com/og/seat?id=WARDEN

**Example (WICK):**
https://satoshiscouncil.com/og/seat?id=WICK

Pass the URL straight to OpenTweet `media_urls`.

## Window / win card

```
GET https://satoshiscouncil.com/og/window?ticker={TICKER}
```

- `{TICKER}` — Kalshi window ticker, e.g. `KXBTC15M-26SEP101730-30`
- Response: `image/png` from that window's replay (winner, call, tape)
- Cache: ~1 hour
- 404 if the ticker is unknown / not in replay

**Example (settled DOWN window):**
https://satoshiscouncil.com/og/window?ticker=KXBTC15M-26SEP101730-30

## Static brand (fallback only)

- https://satoshiscouncil.com/og.jpg
- https://satoshiscouncil.com/seal.png
- https://satoshiscouncil.com/wordmark.png

Prefer `/og/seat` and `/og/window` for daily seat intros and win cards.

## Notes

- Paper desk only. These endpoints invent no prints; they render from the live
  frame / replay store.
- Do not POST binaries to the site for X. If a custom asset is ever required,
  that is a separate Chief-approved change.