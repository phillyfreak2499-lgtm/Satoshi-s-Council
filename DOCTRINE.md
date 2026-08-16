# Satoshi’s Council — Operating Doctrine

**Version:** Longer-Horizon Research Desk (August 2026)  
**Status:** Adopted as governing doctrine — implementation in progress

> This document states the rules the system is **held to**, not a description of current behavior.
> Several rules below are ahead of the code: the analysis loop still runs on a short Kalshi window
> cadence, the API still emits `UP` / `DOWN` / `WAIT`, and the process metrics in the *Metrics That
> Matter* section are not yet computed. Where doctrine and code disagree, the doctrine is the target
> and the gap is a bug. See `README.md` → *Implementation Status* for the current scorecard, and
> `PIVOT.md` for why this changed. The superseded short-horizon doctrine is archived in
> `DOCTRINE-LEGACY-PATH.md`.

---

## Mission

Help the user make fewer, higher-quality decisions by requiring specialist debate and meaningful confluence before action.

The Council exists to improve **process under uncertainty**.  
Profit is a possible byproduct of good process — never the primary target of the system itself.

---

## Non-Negotiable Rules

1. **Paper first**  
   No real-capital recommendations or live signals until a meaningful sample of decisions has been tracked under these rules.

2. **Longer horizons preferred**  
   The system is oriented toward multi-hour to multi-day / swing decisions. Short-term noise is de-emphasized.

3. **Confluence required**  
   The Chair needs clear agreement among higher-ranked agents before issuing anything stronger than Wait.

4. **WAIT is a first-class outcome**  
   Sitting when agreement is weak is correct process, not failure. Celebrate clean waits.

5. **Process metrics matter**  
   Track confluence quality, wait rate, rule adherence, and agent usefulness alongside any paper results.

6. **No auto-trading**  
   The Council never places an order on its own initiative. Nothing the Chair or any specialist
   emits reaches an exchange automatically.

   *Accurate statement of the code:* a manual Follower order route exists in the backend
   (`POST /api/follower/order`) and can reach a live Kalshi client. It is disabled by default and
   requires a session unlock, an explicit typed confirmation phrase, and configured credentials
   before it will do anything. Under this doctrine it stays off. The route is documented here rather
   than denied, because a doctrine that misdescribes its own attack surface is not a safety control.

   The same applies to the Side Table and THE FRONT desks, which carry their own arming phrases and
   loss caps. Both stay disarmed under this doctrine.

7. **Risk awareness is mandatory**  
   Any future real-capital use must include explicit position-size limits, maximum concurrent risk, and hard drawdown rules.

8. **Agents are ranked by recent usefulness**  
   Chronic under-performers lose influence. Rankings are evidence-based, not static.

9. **Free public data preferred for core analysis**  
   The system runs on publicly available feeds and must never *require* a paid plan to start.

   *Known exception:* the CoinGlass-backed seats — CARRY (`funding`), CHAIN (`oi_pressure`), and
   CASCADE (`liq`) — sit behind a plan wall and force WAIT when it latches. Resolving this so those
   seats degrade gracefully instead of going silent is an open item, not a solved one.

10. **Honesty over marketing**  
    The system will not pretend to have an edge it has not demonstrated in paper tracking.

---

## Chair Behavior

The Chair synthesizes. It does not invent conviction.

- When diversity is low or top agents disagree → default output is **Wait**
- When confluence is strong and ranked agents align → directional lean with confidence and horizon
- The Chair may revise an open decision if new information changes the balance of ranked agreement. A revision is a normal outcome over a multi-day horizon, not a failed call

---

## Decision Language

Replace short-term directional calls with:

- **Accumulate**
- **Buy Zone**
- **Hold**
- **Reduce**
- **Sell**
- **Wait**

Every non-Wait decision should carry:
- Confidence score
- Suggested horizon (example: “days to weeks”)
- Brief synthesis of why the ranked agents agree

---

## Grading & Learning

Paper decisions are logged with:
- Prevailing confluence score
- Agent rankings at the time of decision
- Stated horizon
- Later outcome over that horizon
- Process grade (did we follow the rules?)

Weights and ranks update from this history.  
Path or short-window Kalshi-style grading is retired for the primary research desk.

---

## Visual & UX Hierarchy

- **Table (Art mode)**: Clean decision stage with live dual or multi-asset plaques
- **Floor / Dashboard**: Full specialist visibility, ranks, debate log
- Hierarchy, adaptive weights, and ranking continue to operate
- Gold / special highlighting for strong confluence remains available

---

## Follower / Live Interface

Follower stays **OFF** by default.  
Live capital execution stays **OFF**.  
Paper only until the doctrine conditions above are met.

---

## Metrics That Matter

Track on the Paper / Accuracy surfaces:

- Confluence quality distribution
- Wait rate
- Rule adherence rate
- Agent usefulness ranking over time
- Paper expectancy over stated horizons (secondary)
- Maximum paper drawdown under the rules

---

## Final Principle

The goal is better process under uncertainty.  

A clean Wait is a successful use of the system.  
A forced low-confluence action is a process failure even if it happens to make money.

Paper-track expectancy and process quality before any size.
