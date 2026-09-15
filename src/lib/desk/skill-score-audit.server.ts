/** Public read-only evidence. No consumer in the learner or Chair. */
import { getSql } from "@/lib/db";
import { SCORE_AUDIT_START, SCORE_AUDIT_VERSION, type SkillScoreAudit } from "./skill-score-audit";

export type PublicSkillScoreAudit = {
  at: string;
  available: boolean;
  start: string;
  recorded_windows: number | null;
  receipts: SkillScoreAudit[];
};

let cached: { expires: number; value: PublicSkillScoreAudit } | null = null;
let pending: Promise<PublicSkillScoreAudit> | null = null;

async function readAudit(): Promise<PublicSkillScoreAudit> {
  const at = new Date().toISOString();
  const start = new Date(SCORE_AUDIT_START).toISOString();
  try {
    const db = await getSql();
    // Read the raw ledger so an excluded observation can retain its skip reason.
    // These are receipt counts, never counted wins or policy observations.
    const rows = await db<{ receipt: SkillScoreAudit; recorded_windows: number }>`
      select skill_score_audit as receipt, count(*) over()::int as recorded_windows
      from desk_ledger
      where close_time >= ${start}::timestamptz
        and skill_score_audit->>'version' = ${SCORE_AUDIT_VERSION}
      order by close_time desc limit 12
    `;
    const value: PublicSkillScoreAudit = { at, available: true, start,
      recorded_windows: rows[0]?.recorded_windows ?? 0, receipts: rows.map(r => r.receipt) };
    cached = { expires: Date.now() + 15_000, value };
    return value;
  } catch {
    // A failed read is unavailable, not a zero-observation claim.
    return { at, available: false, start, recorded_windows: null, receipts: [] };
  }
}

export async function skillScoreAuditSnapshot(): Promise<PublicSkillScoreAudit> {
  if (cached && cached.expires > Date.now()) return cached.value;
  pending ??= readAudit().finally(() => { pending = null; });
  return pending;
}
