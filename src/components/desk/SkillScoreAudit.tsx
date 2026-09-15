import type { SkillCard } from "@/lib/desk/types";
import { SCORE_AUDIT_SKILLS } from "@/lib/desk/skill-score-audit";
import type { PublicSkillScoreAudit } from "@/lib/desk/skill-score-audit.server";

const stamp = (t: number | string) => new Date(t).toISOString().replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC");
const cents = (n: number | null) => n == null || !Number.isFinite(n) ? "MISSING" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}¢`;

export function SkillScoreAudit({ skills, audit, at }: { skills: SkillCard[]; audit?: PublicSkillScoreAudit | null; at?: number }) {
  const cards = skills.filter(s => (SCORE_AUDIT_SKILLS as readonly string[]).includes(s.id));
  if (!cards.length) return null;
  return (
    <section className="mt-3 rounded-md border border-border bg-surface p-4" aria-label="Skill scoring audit">
      <h2 className="font-sans text-title font-medium text-fg">Scoring audit · read only</h2>
      <p className="mt-2 max-w-[80ch] text-body text-muted">
        These rules report signal strength, not a calibrated chance of winning. The legacy value called Brier squares that strength against whether
        the read was right. A low-strength correct read can therefore receive a large error. Corrected historical probability Brier: <strong>MISSING</strong>.
      </p>
      <p className="mt-2 text-micro text-subtle">
        Skill reads are graded from the last usable window input. Their quoted-price results and hit rates are separate from the Chair&apos;s earlier booked fills.
        The audit preserves the existing learner and records evidence for a later review.
      </p>
      {cards.map(card => {
        const legacy = card.brier_n > 0 && Number.isFinite(card.brier_sum) ? card.brier_sum / card.brier_n : null;
        const receipt = audit?.receipts[0];
        const checked = receipt?.skills.find(s => s.id === card.id);
        return (
          <div key={card.id} className="mt-3 border-t border-border pt-3">
            <h3 className="font-mono text-ui text-fg">{card.id}</h3>
            <p className="mt-1 font-mono text-micro text-muted">
              Legacy signal-score error {legacy == null ? "MISSING" : legacy.toFixed(6)} · {card.brier_n} scored reads
              {at != null && Number.isFinite(at) ? ` · counters at ${stamp(at)}` : " · counter timestamp MISSING"}
            </p>
            <p className="mt-1 text-micro text-muted">{card.hits}/{card.n} reads right · {cents(card.ev_n > 0 ? card.ev_sum : null)} hypothetical net at grading quotes, after fees · not booked profit</p>
            {!audit?.available ? <p className="mt-2 text-micro text-wait">New audit records are unavailable.</p>
              : !receipt || !checked ? <p className="mt-2 text-micro text-muted">Awaiting the first new grading receipt. Historical per-read inputs are MISSING.</p>
              : (
                <details className="mt-2 text-micro text-muted">
                  <summary className="cursor-pointer text-fg">Latest counter check: {checked.check} · {checked.observations.length} directional inputs · {receipt.ticker}</summary>
                  <p className="mt-2">Input: {stamp(receipt.input_at)} · close: {stamp(receipt.close_time)} · recorded: {stamp(receipt.graded_at)}</p>
                  <p>{receipt.seconds_to_close.toFixed(1)} seconds before close · {receipt.credit_skip_reason ?? "grading permitted"} · {receipt.source}</p>
                  {!receipt.input_before_close ? <p className="text-wait">Input was at or after close; it is not an advance prediction.</p> : null}
                  {checked.observations.length ? checked.observations.map((row, i) => (
                    <p key={i} className="mt-1 font-mono">
                      {row.path} {row.side} · strength {row.confidence ?? "MISSING"}/100 · {row.hit ? "right" : "wrong"} · squared error {row.legacy_squared_error?.toFixed(6) ?? "MISSING"}
                      {" · "}{cents(row.hypothetical_net_cents)} at recorded ask plus fee{row.credited ? "" : " · not credited"}
                      {row.legacy_quote_fallback ? " · legacy grader used a quote fallback" : ""}
                    </p>
                  )) : <p className="mt-1">Neither a selected nor a paper directional input was scored for this skill in this window.</p>}
                </details>
              )}
          </div>
        );
      })}
      <p className="mt-3 text-micro text-subtle">New receipts only. No reconstructed historical probabilities, replaced grades, or automatic promotions.</p>
      <a href="/skill-score-audit" className="mt-2 inline-block text-micro text-fg underline underline-offset-2">Read the saved audit receipts</a>
    </section>
  );
}
