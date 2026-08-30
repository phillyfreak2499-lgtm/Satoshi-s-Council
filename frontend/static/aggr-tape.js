/* AGGR tape chip — same public bars as https://aggr.trade/aegx */
(function () {
  "use strict";

  var AGGR = "https://api.aggr.trade";
  var TF = 15000;
  var LOOKBACK = 5 * 60 * 1000;
  var WHALE = 100000;
  var LIQ = 50000;
  var MARKETS = {
    btc: "BINANCE_FUTURES:btcusdt+BINANCE:btcusdt+COINBASE:BTC-USD+BYBIT:BTCUSDT+OKEX:BTC-USDT-SWAP",
    eth: "BINANCE_FUTURES:ethusdt+BINANCE:ethusdt+COINBASE:ETH-USD+BYBIT:ETHUSDT+OKEX:ETH-USDT-SWAP",
  };

  function usd(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + "k";
    return String(Math.round(n));
  }

  function summarize(rows) {
    var now = Date.now() / 1000;
    var vbuy = 0, vsell = 0, lbuy = 0, lsell = 0, whale = false, close = null;
    rows.forEach(function (r) {
      if (r.t && r.t < now - 300) return;
      vbuy += r.vbuy; vsell += r.vsell; lbuy += r.lbuy; lsell += r.lsell;
      if (r.close) close = r.close;
      if (r.vbuy >= WHALE || r.vsell >= WHALE) whale = true;
    });
    var total = vbuy + vsell;
    var ratio = total > 0 ? vbuy / total : null;
    var pressure = "mixed";
    if (ratio != null) {
      if (ratio >= 0.62) pressure = "up";
      else if (ratio <= 0.38) pressure = "down";
    }
    var liq = "quiet";
    if (lbuy >= LIQ && lbuy > lsell * 1.25) liq = "longs squeezed";
    else if (lsell >= LIQ && lsell > lbuy * 1.25) liq = "shorts squeezed";
    else if (lbuy + lsell >= LIQ) liq = "both";
    return {
      ok: rows.length > 0,
      vbuy: vbuy, vsell: vsell, lbuy: lbuy, lsell: lsell,
      buy_ratio: ratio, pressure: pressure, liq: liq, whale: whale, close: close,
    };
  }

  function parseBody(body) {
    var cols = (body && body.columns) || {};
    var idx = {
      time: cols.time || 0, vbuy: cols.vbuy || 10, vsell: cols.vsell || 11,
      lbuy: cols.lbuy || 5, lsell: cols.lsell || 7, close: cols.close || 2,
    };
    var rows = [];
    (body.results || []).forEach(function (item) {
      if (!item || !item.length) return;
      var ts = Number(item[idx.time] || 0);
      if (ts > 1e12) ts = ts / 1000;
      rows.push({
        t: ts,
        close: Number(item[idx.close] || 0),
        vbuy: Number(item[idx.vbuy] || 0),
        vsell: Number(item[idx.vsell] || 0),
        lbuy: Number(item[idx.lbuy] || 0),
        lsell: Number(item[idx.lsell] || 0),
      });
    });
    return summarize(rows);
  }

  async function pull(asset) {
    var now = Date.now();
    var url = AGGR + "/historical/" + (now - LOOKBACK) + "/" + now + "/" + TF + "/" + encodeURIComponent(MARKETS[asset]);
    var r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return { ok: false, skip_reason: "http " + r.status };
    return parseBody(await r.json());
  }

  function paint(body) {
    var chip = document.getElementById("aggrChip");
    if (!chip) return;
    var name = document.getElementById("aggrName");
    var note = document.getElementById("aggrNote");
    var left = document.getElementById("aggrLeft");
    var panel = document.getElementById("aggrPanel");
    var btc = (body && body.btc) || {};
    var eth = (body && body.eth) || {};
    var row = btc.ok ? btc : eth;
    var pressure = row.pressure || "mixed";
    var ratio = row.buy_ratio;
    var pct = ratio == null ? "—" : Math.round(ratio * 100) + "% buy";
    chip.className = "aggr-chip press-" + pressure + (row.ok ? "" : " off");
    if (name) name.textContent = row.ok ? "AGGR TAPE" : "AGGR DARK";
    if (note) note.textContent = row.ok ? (pressure === "up" ? "buyers" : pressure === "down" ? "sellers" : "mixed") : (row.skip_reason || "no feed");
    if (left) left.textContent = row.ok ? pct : "";
    if (!panel) return;
    function block(label, s) {
      if (!s || !s.ok) return '<div class="aggr-row"><b>' + label + "</b><span>dark</span></div>";
      return (
        '<div class="aggr-row press-' + (s.pressure || "mixed") + '">' +
        "<b>" + label + "</b>" +
        "<span>" + usd(s.vbuy) + " buy / " + usd(s.vsell) + " sell · 5m</span>" +
        "<small>liq " + (s.liq || "quiet") + " · L" + usd(s.lbuy) + " / S" + usd(s.lsell) + (s.whale ? " · whale" : "") + "</small>" +
        "</div>"
      );
    }
    panel.innerHTML = block("BTC", btc) + block("ETH", eth) +
      '<a class="aggr-link" href="https://aggr.trade/aegx" target="_blank" rel="noopener">open aegx chart</a>';
  }

  async function tick() {
    try {
      var desk = await fetch("/api/aggr", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      if (desk.ok) {
        paint(await desk.json());
        return;
      }
    } catch (e) {}
    try {
      var btc = await pull("btc");
      var eth = await pull("eth");
      paint({ btc: btc, eth: eth });
    } catch (e) {
      paint({ btc: { ok: false, skip_reason: "unreachable" } });
    }
  }

  function bind() {
    var chip = document.getElementById("aggrChip");
    var panel = document.getElementById("aggrPanel");
    if (!chip || !panel) return;
    chip.addEventListener("click", function () {
      var open = panel.hasAttribute("hidden");
      if (open) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
      chip.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function (e) {
      if (!chip.contains(e.target) && !panel.contains(e.target)) {
        panel.setAttribute("hidden", "");
        chip.setAttribute("aria-expanded", "false");
      }
    });
  }

  function inject() {
    if (document.getElementById("aggrChip")) return;
    var session = document.querySelector(".session-wrap");
    var clock = document.getElementById("liveClock");
    var host = (session && session.parentNode) || (clock && clock.parentNode) || document.querySelector("header .logo");
    if (!host) return;
    if (!document.querySelector("link[data-aggr-tape]")) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/static/aggr-tape.css?v=20260830a";
      link.setAttribute("data-aggr-tape", "1");
      document.head.appendChild(link);
    }
    var wrap = document.createElement("div");
    wrap.className = "aggr-wrap";
    wrap.innerHTML =
      '<button type="button" id="aggrChip" class="aggr-chip off" aria-expanded="false" aria-controls="aggrPanel" title="AGGR multi-exchange tape">' +
      '<span class="aggr-dot" aria-hidden="true"></span>' +
      '<span id="aggrName">AGGR TAPE</span>' +
      '<span id="aggrNote">loading</span>' +
      '<span id="aggrLeft" class="aggr-left"></span>' +
      "</button>" +
      '<div id="aggrPanel" class="aggr-panel" hidden></div>';
    if (session && session.nextSibling) host.insertBefore(wrap, session.nextSibling);
    else if (session) host.appendChild(wrap);
    else if (clock && clock.nextSibling) host.insertBefore(wrap, clock.nextSibling);
    else host.appendChild(wrap);
  }

  function boot() {
    inject();
    if (!document.getElementById("aggrChip")) {
      setTimeout(boot, 800);
      return;
    }
    bind();
    tick();
    setInterval(tick, 15000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
