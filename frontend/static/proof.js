(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const clean = (value, fallback = "0") => value == null || value === "" ? fallback : String(value);
  function node(tag, value, className) { const item = document.createElement(tag); if (className) item.className = className; item.textContent = value; return item; }
  function renderHorizon(metrics) { const host = $("#horizonRows"); host.replaceChildren(); const rows = metrics && metrics.by_horizon && typeof metrics.by_horizon === "object" ? Object.entries(metrics.by_horizon) : [];
    if (!rows.length) { host.append(node("div", "No directional horizons have completed yet. That is a sample-size fact, not a gap to fill with confidence.", "entry-empty")); return; }
    rows.sort(([a], [b]) => a.localeCompare(b)).forEach(([horizon, bucket]) => { const row = document.createElement("div"); row.className = "horizon-row"; const completed = Number(bucket && bucket.n || 0); const correct = Number(bucket && bucket.correct || 0); row.append(node("span", horizon), node("small", `${correct} directional outcomes aligned / ${completed} completed reviews`)); host.append(row); });
  }
  function renderAssets(byAsset) { const host = $("#assetRows"); host.replaceChildren(); const pairs = Object.entries(byAsset && typeof byAsset === "object" ? byAsset : {}); if (!pairs.length) { host.append(node("div", "The desk is warming; coverage appears here as append-only records are created.", "entry-empty")); return; } pairs.sort(([a], [b]) => a.localeCompare(b)).forEach(([asset, count]) => { const card = document.createElement("div"); card.className = "asset-row"; card.append(node("strong", clean(asset).toUpperCase()), node("span", `${clean(count)} recorded decisions`)); host.append(card); }); }
  async function load() { try { const response = await fetch("/api/public/proof", { credentials: "same-origin" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "The public ledger is unavailable."); const metrics = data.evaluation || {};
      $("#decisions").textContent = clean(data.decision_records); $("#waits").textContent = clean(data.wait_records); $("#evaluations").textContent = clean(metrics.evaluated_directional_n); $("#waitReviews").textContent = clean(metrics.wait_reviewed_n); $("#proofNote").textContent = clean(data.note, "Read sample size before interpreting outcomes."); renderHorizon(metrics); renderAssets(data.records_by_asset);
    } catch (error) { $("#proofNote").textContent = error.message; renderHorizon({}); renderAssets({}); } }
  load();
})();
