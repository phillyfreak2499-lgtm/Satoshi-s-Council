/** Read-only grade receipts; no historical grade or counter is changed. */
export default async function skillScoreAudit() {
  const { skillScoreAuditSnapshot } = await import("../../src/lib/desk/skill-score-audit.server");
  const result = await skillScoreAuditSnapshot();
  return new Response(JSON.stringify(result, null, 2), {
    status: result.available ? 200 : 503,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
