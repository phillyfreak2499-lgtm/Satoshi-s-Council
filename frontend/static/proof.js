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
  function renderWaitHero(wh) {
    const big = $("#waitRateBig"), line = $("#waitHeroLine"), small = $("#waitHeroSample");
    if (!big) return;
    if (wh && wh.wait_rate != null) {
      big.textContent = "WAIT — " + wh.wait_rate + "% of all calls";
      small.textContent = wh.wait_n + " documented WAITs across " + wh.total_n + " decisions.";
    } else if (wh) {
      big.textContent = "WAIT — sample warming";
      small.textContent = "Only " + (wh.total_n || 0) + " decisions so far; rates appear at " + (wh.min_sample || 10) + "+.";
    }
    if (line && wh && wh.line) line.textContent = wh.line + " Sitting when agreement is weak is correct process.";
  }
  function renderPnl(pp) {
    const svg = $("#pnlChart"), legend = $("#pnlLegend"), label = $("#pnlLabel");
    if (!svg) return;
    const pts = (pp && Array.isArray(pp.points)) ? pp.points : [];
    if (!pts.length) {
      if (label) label.textContent = "No settled windows since Monday yet — the curve starts with the next graded window. Paper only.";
      return;
    }
    const series = [["desk", "#39ff14"], ["coin_flip", "#8fa2c4"], ["fade_mid", "#c9a44a"], ["sit_flat", "#5a6b8c"]];
    let lo = Infinity, hi = -Infinity;
    pts.forEach(function (r) { series.forEach(function (sd) { const v = Number(r[sd[0]]); if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    if (!isFinite(lo)) return;
    if (hi - lo < 20) { hi += 10; lo -= 10; }
    const W = 640, H = 240, PAD = 8;
    const x = function (i) { return pts.length < 2 ? W / 2 : PAD + (W - 2 * PAD) * i / (pts.length - 1); };
    const y = function (v) { return H - PAD - (H - 2 * PAD) * (v - lo) / (hi - lo); };
    let out = "";
    series.forEach(function (sd) {
      const key = sd[0], color = sd[1];
      const d = pts.map(function (r, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(Number(r[key])).toFixed(1); }).join(" ");
      out += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + (key === "desk" ? 2.4 : 1.3) + '" opacity="' + (key === "desk" ? 1 : 0.75) + '"/>';
    });
    svg.innerHTML = out;
    if (legend) {
      legend.replaceChildren();
      const names = { desk: "Desk (path book)", coin_flip: "Coin-flip", fade_mid: "Always-fade mid", sit_flat: "Sit flat" };
      series.forEach(function (sd) {
        const chip = document.createElement("span");
        chip.className = "pnl-chip";
        chip.innerHTML = '<i style="background:' + sd[1] + '"></i>' + names[sd[0]];
        legend.append(chip);
      });
    }
    if (label) {
      const last = pts[pts.length - 1];
      label.textContent = "Since " + clean(pp.since) + ": desk $" + clean(last.desk) + " · coin-flip $" + clean(last.coin_flip) +
        " · fade-mid $" + clean(last.fade_mid) + " · sit $1000. " + clean(pp.label, "Paper only — not a promise.");
    }
  }
  async function load() { try { const response = await fetch("/api/public/proof", { credentials: "same-origin" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "The public ledger is unavailable."); const metrics = data.evaluation || {};
      renderWaitHero(data.wait_hero); renderPnl(data.path_pnl);
      $("#decisions").textContent = clean(data.decision_records); $("#waits").textContent = clean(data.wait_records); $("#evaluations").textContent = clean(metrics.evaluated_directional_n); $("#waitReviews").textContent = clean(metrics.wait_reviewed_n); $("#proofNote").textContent = clean(data.note, "Read sample size before interpreting outcomes."); renderHorizon(metrics); renderAssets(data.records_by_asset);
    } catch (error) { $("#proofNote").textContent = error.message; renderHorizon({}); renderAssets({}); } }
  load();
})();
