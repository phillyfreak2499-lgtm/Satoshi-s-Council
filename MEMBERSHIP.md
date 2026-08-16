# Membership & Access Structure

Simple, low-friction tiers designed to start recovering sunk cost while keeping the barrier to entry low.

> **Status: proposed, not built.** Nothing in this document is currently implemented. Access today
> is a single shared password (`COUNCIL_ACCESS_PASSWORD`) that fails closed — there is no free tier,
> no delayed view, no per-member flag, and no payment integration. Treat this as the pricing plan to
> build toward, and do not publish these tiers as if they are live. Two of the listed Council Member
> benefits also depend on unbuilt functionality (see the notes under that tier).

---

## Free Access

**What you get**
- Limited or delayed Round Table view
- Basic overall decision and summary
- Public process / accuracy statistics
- Ability to see the system and feel the difference

**Goal**  
Let people experience the Council without friction. Convert the ones who want the full live debate, rankings, and history.

---

## Council Member — $24 / month

**What you get**
- Full live Round Table — *currently BTC + ETH only, not multi-coin. Do not advertise "multi-coin" until further majors are actually wired.*
- Complete agent reasoning and rankings
- Full debate log
- Historical decisions and paper-tracking view — *outcome stats exist; the process metrics (wait rate, rule adherence, confluence quality) are not yet computed*
- Priority access to doctrine and logic updates
- Ability to follow the process in real time

**Recommended starting price:** $24 USD / month  
(Early supporters can be offered annual pricing at a discount.)

---

## Early Supporter / Annual Options

- **Annual**: $240 / year — exactly 2 months free against $24/mo
  - A deeper early-supporter price of $199/year is ~31% off; describe it that way rather than as "2 months free"
- **Lifetime** (optional, limited): Higher one-time fee while the system is early and still evolving

These options help with cash recovery and reward people who support the pivot early.

---

## Bundle Option

**Council Member + The Council Method playbook**

Offer a combined price (example: first month + playbook, or annual + playbook) so the digital product and the live tool reinforce each other.

---

## Implementation Notes

- Use Stripe (or equivalent) for simplicity.
- Start with manual or lightweight access control if needed (password tiers, invite codes, or simple member flag).
- Do not over-build feature gating at launch. The main value is the full live Round Table + history + reasoning.
- Free tier should still feel useful so visitors understand what they are buying.

---

## Pricing Philosophy

- Low enough that a serious researcher will try it
- High enough that it begins to offset hosting, domain, and development costs
- Transparent and simple — no dark patterns or complex tier ladders at the start

Adjust after real usage data. The first goal is recovery and validation, not maximum extraction.
