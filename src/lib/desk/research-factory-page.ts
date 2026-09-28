/**
 * The research reports admin page (pure HTML rendering).
 *
 * One read-only page over everything the research side records: collector and
 * factory health, the research summary, every experiment arm's lifecycle and
 * evidence safety, the instrument tests' verdicts, and every stored report as
 * escaped raw JSON. Served by server/routes/research/reports.get.ts behind the
 * admin key; it never receives the key, so it can never print it.
 *
 * Static HTML only: no script, no external resource, collapsible sections are
 * <details>. Every value that came from the database is escaped.
 */

type Obj = Record<string, unknown>;
export type StoredReport = { report_kind: string; report_key: string; report_version: number; payload: unknown; created_at: string | null; build_sha?: string | null };
export type PageInput = {
  generated_at: string;
  /** researchFactoryReport() without a kind: health, jobs, failures, authority. */
  overview: Obj;
  /** The latest version of every report with key "latest". */
  latest: readonly StoredReport[];
  /** The most recent daily digest, if any. */
  digest: StoredReport | null;
};

/** Raw JSON per report is cut at this many characters so one huge report cannot make the page unusable. */
export const MAX_RAW_CHARS = 200_000;

export const esc = (x: unknown): string =>
  String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const obj = (x: unknown): Obj | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const fmt = (x: unknown, d = 1): string => { const n = num(x); return n == null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(d); };
/** Small objects read as "key: value · key: value"; anything deeper falls back to compact JSON. Always escaped. */
function pretty(x: unknown, depth = 0): string {
  if (x == null || x === "") return "—";
  if (Array.isArray(x)) return x.length ? x.map((v) => pretty(v, depth + 1)).join(", ") : "none";
  if (typeof x === "object") {
    const entries = Object.entries(x as Obj);
    if (!entries.length) return "none";
    if (depth > 1) return JSON.stringify(x);
    return entries.map(([k, v]) => (k === "none" ? pretty(v, depth + 1) : `${k.replace(/_/g, " ")}: ${pretty(v, depth + 1)}`)).join(" · ");
  }
  return String(x);
}
const cell = (x: unknown): string => esc(pretty(x));

function table(head: readonly string[], rows: ReadonlyArray<ReadonlyArray<string>>, empty: string): string {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

const badge = (text: unknown, tone: "good" | "bad" | "warn" | "plain" = "plain") => `<span class="badge ${tone}">${esc(text)}</span>`;

function toneOf(v: unknown): "good" | "bad" | "warn" | "plain" {
  const s = String(v ?? "");
  if (/^(CLEAN|ALL_FILLS|INFORMATIVE_CANDIDATE|COLLECTING|PROMISING)$/.test(s)) return "good";
  if (/^(INVALID|INVALID_EVIDENCE|NONE|RETIRE_CANDIDATE|RETIRED|FAILED)$/.test(s)) return "bad";
  if (/^(SUSPECT|CLEAN_SUBSET_ONLY|INSUFFICIENT_SAMPLE|DIAGNOSTIC_ONLY|UNVERIFIABLE|NEEDS_REVIEW)$/.test(s)) return "warn";
  return "plain";
}

function healthSection(o: Obj): string {
  const rows: string[][] = [];
  const factory = obj(o.health);
  if (factory) rows.push(["research factory", badge(factory.enabled ? "on" : "off", factory.enabled ? "good" : "plain"), badge(factory.running ? "running" : "idle"), `${fmt(factory.completed)} jobs done · ${fmt(factory.paused)} paused`, cell(factory.error)]);
  const collectors: Array<[string, string]> = [["decision tape", "decision_tape"], ["book depth", "book_depth"], ["trade flow", "trade_flow"], ["WICK shadow", "wick_shadow"]];
  for (const [label, k] of collectors) {
    const h = obj(o[k]);
    if (!h) continue;
    const venues = obj(h.venues);
    const extra = venues
      ? Object.entries(venues).map(([v, s]) => { const x = obj(s); return x ? `${esc(v)}: ${fmt(x.written)} min, ${fmt(x.gaps)} gaps${x.halted ? `, ${esc(x.halted)}` : ""}` : `${esc(v)}: —`; }).join("<br>")
      : `${fmt(h.written)} written${h.book_missing != null ? ` · ${fmt(h.book_missing)} book missing` : ""}${h.fired != null ? ` · ${fmt(h.fired)} fired` : ""}`;
    rows.push([esc(label), badge(h.enabled ? "on" : "off", h.enabled ? "good" : "plain"), badge(h.running ? "running" : "idle"), extra, cell(h.error)]);
  }
  const guard = obj(factory?.last_guard);
  const jobs = arr(o.jobs).map((j) => { const x = obj(j) ?? {}; return [cell(x.job_kind), badge(x.status, x.status === "failed" ? "bad" : x.status === "complete" ? "good" : "plain"), fmt(x.n)]; });
  const failures = arr(o.recent_failures).map((j) => { const x = obj(j) ?? {}; return [cell(x.job_kind), cell(x.job_key), fmt(x.attempts), cell(x.error), cell(x.updated_at)]; });
  return `<section><h2>Collectors and factory</h2>
${table(["component", "switch", "state", "written", "last error"], rows, "no health reported")}
${guard ? `<p class="muted">last resource guard: ${cell(guard)}</p>` : ""}
<h3>Jobs</h3>${table(["kind", "status", "count"], jobs, "no jobs yet")}
${failures.length ? `<h3>Recent failures</h3>${table(["kind", "key", "attempts", "error", "when"], failures, "")}` : ""}</section>`;
}

function summarySection(p: Obj | null): string {
  if (!p) return "";
  const line = (label: string, v: unknown) => `<dt>${esc(label)}</dt><dd>${cell(v)}</dd>`;
  return `<section><h2>Research summary</h2><dl>
${line("current bottleneck", p.current_bottleneck)}
${line("highest-leverage single change", p.highest_leverage_isolated_change)}
${line("best incremental signal", p.best_incremental_signal)}
${line("most redundant signal", p.most_redundant_signal)}
${line("next prospective experiment", p.next_prospective_experiment)}
</dl><p class="muted">${cell(obj(p.honesty)?.rule)}</p></section>`;
}

function lifecycleSection(p: Obj | null): string {
  const rows = arr(p?.rows).map((r) => {
    const x = obj(r) ?? {};
    const s = obj(x.current_sample) ?? {};
    const res = obj(x.current_result) ?? {};
    const ci = obj(res.win_rate_ci95);
    const nf = obj(x.matched_null_fav) ?? {};
    return [
      cell(x.experiment), `<b>${cell(x.arm)}</b>`, badge(x.status, toneOf(x.status)), badge(x.promotion_eligible ? "eligible" : "no", x.promotion_eligible ? "good" : "plain"),
      fmt(s.observed_windows), fmt(s.fills), fmt(s.clean_settled_fills), fmt(s.suspect_fills), fmt(s.invalid_fills),
      res.win_rate_pct == null ? "—" : `${fmt(res.win_rate_pct)}%${ci ? ` <span class="muted">[${fmt(ci.lo)}–${fmt(ci.hi)}]</span>` : ""}`,
      res.breakeven_win_rate_pct == null ? "—" : `${fmt(res.breakeven_win_rate_pct)}%`, fmt(res.net_cents), fmt(nf.net_cents),
      x.flag_for_human_review ? badge("review", "warn") : "",
    ];
  });
  return `<section><h2>Experiments: lifecycle</h2>${table(["experiment", "arm", "status", "promotion", "windows", "fills", "clean settled", "suspect", "invalid", "win rate [95%]", "break-even", "net ¢", "null-fav net ¢", ""], rows, "no lifecycle report yet")}
<p class="muted">Win rates count CLEAN settled fills only. Nothing here promotes anything; promotion always needs a separate, human-approved production trial.</p></section>`;
}

function safetySection(p: Obj | null): string {
  const rows = arr(p?.rows).map((r) => {
    const x = obj(r) ?? {};
    return [cell(x.experiment), `<b>${cell(x.arm)}</b>`, badge(x.safe_to_use, toneOf(x.safe_to_use)), fmt(x.fills), fmt(x.evidence_grade_fills), cell(x.receipt_statuses),
      arr(x.top_reasons).map((t) => { const y = obj(t) ?? {}; return `${esc(y.code)} ×${fmt(y.n)}`; }).join("<br>") || "—"];
  });
  return `<section><h2>Evidence safety</h2><p>${cell(p?.question)}</p>${table(["experiment", "arm", "safe to use", "fills", "evidence-grade", "receipt statuses", "top reasons"], rows, "no evidence-safety report yet")}</section>`;
}

function instrumentsSection(byKind: ReadonlyMap<string, StoredReport>): string {
  const rows: string[][] = [];
  for (const [kind, label] of [["book_depth", "Kalshi book depth"], ["trade_flow", "spot/perp signed flow"], ["wick_shadow", "formalized WICK (shadow)"]] as const) {
    const r = byKind.get(kind);
    const p = obj(r?.payload);
    const h0 = obj(p?.h0);
    const spec = obj(h0?.h0);
    if (!r) { rows.push([esc(label), badge("no report yet"), "—", "—", "—"]); continue; }
    rows.push([esc(label), badge(h0?.verdict ?? "—", toneOf(h0?.verdict)), `${fmt(h0?.clean_observations)} / ${fmt(spec?.min_clean_observations)}${h0?.fires != null ? ` · ${fmt(h0.fires)} fires` : ""}`, cell(spec?.id), cell(r.created_at)]);
  }
  return `<section><h2>Instrument tests</h2>${table(["instrument", "H0 verdict", "clean sample / needed", "pre-registered test", "report time"], rows, "")}
<p class="muted">Each test runs only at its pre-registered minimum clean sample. RETIRE_CANDIDATE means the signal restates the price; INFORMATIVE_CANDIDATE only earns a frozen prospective shadow test. Collection quality is inside each report below.</p></section>`;
}

function rawJson(r: StoredReport): string {
  let text = JSON.stringify(r.payload, null, 2) ?? "null";
  const cut = text.length > MAX_RAW_CHARS;
  if (cut) text = text.slice(0, MAX_RAW_CHARS);
  return `<details><summary><b>${esc(r.report_kind)}</b> <span class="muted">${esc(r.report_key)} · v${esc(r.report_version)} · ${esc(r.created_at ?? "")}${r.build_sha ? ` · ${esc(String(r.build_sha).slice(0, 7))}` : ""}</span></summary>
<pre>${esc(text)}${cut ? `\n… cut at ${MAX_RAW_CHARS.toLocaleString("en-US")} characters; the JSON route has it all` : ""}</pre></details>`;
}

const JSON_ROUTES = [
  ["/research/factory", "factory overview, or ?kind=<report>&report_key=<key> for one report"],
  ["/research", "Phase 2 measurement board"],
] as const;

export function renderResearchPage(input: PageInput): string {
  const byKind = new Map(input.latest.map((r) => [r.report_kind, r]));
  const p = (k: string) => obj(byKind.get(k)?.payload);
  const util = p("utilization");
  const authority = obj(input.overview.authority);
  const rest = [...input.latest].sort((a, b) => a.report_kind.localeCompare(b.report_kind));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>Research reports</title>
<style>
:root{--bg:#fbfbfa;--fg:#1d1d1b;--muted:#6b6b66;--line:#e2e1dc;--card:#fff;--good:#1f7a4d;--bad:#b3261e;--warn:#9a6700;--chip:#efeee9}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--muted:#9c9b94;--line:#2e2e2b;--card:#1c1c1a;--good:#5cc28d;--bad:#f2837a;--warn:#e0b44c;--chip:#2a2a27}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1200px;margin:0 auto;padding:16px}h1{font-size:22px;margin:8px 0 4px}h2{font-size:17px;margin:0 0 10px}h3{font-size:14px;margin:14px 0 6px}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0}
.muted{color:var(--muted)}.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top;white-space:nowrap}td:last-child{white-space:normal}
th{font-weight:600;color:var(--muted);font-size:12px}.badge{display:inline-block;padding:1px 7px;border-radius:999px;background:var(--chip);font-size:12px}
.badge.good{color:var(--good)}.badge.bad{color:var(--bad)}.badge.warn{color:var(--warn)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
@media (max-width:600px){dl{display:block}dt{margin-top:8px}main{padding:12px}section{padding:12px}}
details{border-top:1px solid var(--line);padding:6px 0}summary{cursor:pointer}pre{overflow:auto;max-height:480px;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12px}
code{font-size:12px}
</style></head><body><main>
<h1>Research reports</h1>
<p class="muted">Read only · generated ${esc(input.generated_at)} · production authority ${esc(authority?.production_authority ?? "NONE")} · auto-promotion ${esc(String(authority?.auto_promotion ?? false))} · paid APIs ${esc(authority?.paid_apis ?? "none")}</p>
${healthSection(input.overview)}
${summarySection(p("research_summary"))}
${lifecycleSection(p("lifecycle"))}
${safetySection(p("evidence_safety"))}
${instrumentsSection(byKind)}
${util ? `<section><h2>Research compute</h2><p>${fmt(util.jobs)} jobs in the last 24 h · CPU ${fmt(util.cpu_ms, 0)} ms · utilization ${cell(util.research_compute_utilization)} · peak RSS ${fmt(util.peak_rss_mb, 0)} MB · resource-guard pauses ${cell(util.resource_guard_pauses)}</p><p class="muted">${cell(util.note)}</p></section>` : ""}
${input.digest ? `<section><h2>Latest daily digest (${esc(input.digest.report_key)})</h2>${rawJson(input.digest)}</section>` : ""}
<section><h2>All reports</h2>${rest.length ? rest.map(rawJson).join("\n") : `<p class="muted">No reports yet. They appear after the research factory's first hourly rollup (RESEARCH_FACTORY_ENABLED=true).</p>`}</section>
<section><h2>JSON routes</h2><p class="muted">Each needs the same admin key. Each recovery experiment also has its own report route; see its doc under docs/.</p><ul>${JSON_ROUTES.map(([path, what]) => `<li><code>${esc(path)}</code>: ${esc(what)}</li>`).join("")}</ul></section>
</main></body></html>`;
}
