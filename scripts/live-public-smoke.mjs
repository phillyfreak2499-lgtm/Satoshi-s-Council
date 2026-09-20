const origin = (process.env.PUBLIC_ORIGIN || "https://satoshiscouncil.com").replace(/\/$/, "");
const timeoutMs = Number(process.env.PUBLIC_SMOKE_TIMEOUT_MS || 20000);

const surfaces = [
  ["/", ["A clearer view.", "Paper research. Public prices. No live orders."]],
  ["/desk", ["Satoshi", "Paper position"]],
  ["/books", ["Results, on the record.", "outages, not sits"]],
  ["/record", ["The week on the record.", "One fill that was wrong"]],
  ["/arena", ["Paper calls only.", "ranked after 3 settled"]],
  ["/board", ["The Board", "Posts do not change the Chair or place orders."]],
  ["/training", ["Start with WICK.", "Paper only. No live orders."]],
  ["/training/wick", ["WICK"]],
  ["/training/tape", ["TAPE"]],
  ["/training/drift", ["DRIFT"]],
  ["/legal", ["Paper only, in plain words", "Questions about the desk"]],
  ["/about", ["How the desk works", "21 Council seats", "18 voting specialists", "3 non-voting pit crew"]],
  ["/faq", ["Questions people ask", "How many Council seats actually vote?", "18 voting specialists", "3 non-voting pit crew"]],
];

let failed = false;

for (const [path, must] of surfaces) {
  const url = origin + path;
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    const problems = [];
    if (!res.ok) problems.push(`HTTP ${res.status}`);
    if (body.length < 200) problems.push(`thin body ${body.length} chars`);
    for (const phrase of must) {
      if (!body.toLowerCase().includes(phrase.toLowerCase())) problems.push(`missing "${phrase}"`);
    }
    if (path === "/board" && /Loading…|Loading\.\.\./.test(body)) problems.push("Board exposes a Loading… state");
    if (problems.length) {
      failed = true;
      console.error(`FAIL ${path}: ${problems.join("; ")}`);
    } else {
      console.log(`OK   ${path} -> ${res.url}`);
    }
  } catch (error) {
    failed = true;
    console.error(`FAIL ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function booksParity() {
  const [pageRes, apiRes] = await Promise.all([
    fetch(`${origin}/books`, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "cache-control": "no-cache" } }),
    fetch(`${origin}/api/books`, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json", "cache-control": "no-cache" } }),
  ]);
  if (!pageRes.ok || !apiRes.ok) return { ok: false, detail: `books HTTP page=${pageRes.status} api=${apiRes.status}` };
  const [html, api] = await Promise.all([pageRes.text(), apiRes.json()]);
  const ticker = api?.last?.ticker;
  const net = Number(api?.week?.net);
  if (typeof ticker !== "string" || !ticker || !Number.isFinite(net)) return { ok: false, detail: "books API missing parity fields" };
  const netText = `${net > 0 ? "+" : ""}${net.toFixed(1)}¢`;
  const missing = [ticker, netText].filter((value) => !html.includes(value));
  return { ok: missing.length === 0, detail: missing.length ? `SSR missing current ${missing.join(", ")}` : `${ticker} · ${netText}` };
}

let parity = await booksParity();
if (!parity.ok) {
  console.warn(`WARN /books parity first pass: ${parity.detail}; retrying after cache horizon`);
  await new Promise((resolve) => setTimeout(resolve, 32_000));
  parity = await booksParity();
}
if (!parity.ok) {
  failed = true;
  console.error(`FAIL /books parity: ${parity.detail}`);
} else {
  console.log(`OK   /books parity: ${parity.detail}`);
}

try {
  const nav = await fetch(`${origin}/`, { signal: AbortSignal.timeout(timeoutMs) }).then((r) => r.text());
  const m = nav.match(/https:\/\/[^"'<>\s]*fourthwall\.com\/?/i);
  if (m) {
    const shop = await fetch(m[0], { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    console.log(`SHOP ${shop.status} -> ${shop.url}`);
    if (!shop.ok) failed = true;
  } else {
    console.log("SHOP no Fourthwall URL in homepage HTML; verify the configured shop destination separately.");
  }
} catch (error) {
  failed = true;
  console.error(`FAIL shop: ${error instanceof Error ? error.message : String(error)}`);
}

process.exitCode = failed ? 1 : 0;
