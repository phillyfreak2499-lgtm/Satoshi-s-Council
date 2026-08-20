/**
 * Satoshi’s Council — wire.js
 *
 * Boot before roundtable.js.
 *
 * 2026-08-20-stream-desk-split
 *   Desk = Floor / Table + every professional tab (ETH, weather, charts,
 *   tape, paper, dojo, settings). Stream = Night tab, cinematic 24/7
 *   broadcast for X / YouTube / Twitch / OBS.
 */
(() => {
  "use strict";

  const BUILD = "2026-08-20-stream-desk-split";
  window.COUNCIL_BUILD = BUILD;

  window.assetTag = function assetTag(url) {
    if (!url) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "v=" + encodeURIComponent(BUILD);
  };

  window.councilHealth = async function councilHealth() {
    try {
      const r = await fetch("/health", { headers: { Accept: "application/json" } });
      if (!r.ok) return { status: "unreachable" };
      return await r.json();
    } catch (e) {
      return { status: "unreachable" };
    }
  };

  const FACE = {
    wick: "/portraits/wick.jpg",
    strike: "/portraits/strike.jpg",
    odds: "/portraits/odds.jpg",
    quorum: "/portraits/quorum.jpg",
    clock: "/portraits/clock.jpg",
    satoshi: "/portraits/satoshi-up.jpg"
  };

  function remap(url) {
    var s = String(url || "");
    if (!s || s.indexOf("/portraits/") !== -1) return s;
    var lower = s.toLowerCase();
    if (/chamber\.jpg|satoshi-table\.jpg/.test(lower)) return "";
    if (/chair-up|chair-wait|chair-down|chair-sell|satoshi-shrine/.test(lower)) {
      return FACE.satoshi;
    }
    var names = ["wick", "strike", "odds", "quorum", "clock"];
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (new RegExp("(?:^|[/_.-])" + n + "(?:[-_.]|\\.|$)", "i").test(lower) &&
          /bots|static|chair|portrait/.test(lower)) {
        return FACE[n];
      }
    }
    return s;
  }

  var proto = HTMLImageElement.prototype;
  var desc = Object.getOwnPropertyDescriptor(proto, "src");
  if (desc && desc.set && desc.get) {
    Object.defineProperty(proto, "src", {
      configurable: true,
      enumerable: desc.enumerable,
      get: function () { return desc.get.call(this); },
      set: function (v) {
        var mapped = remap(v);
        if (!mapped) {
          desc.set.call(this, "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==");
          return;
        }
        desc.set.call(this, mapped);
      }
    });
  }
  var origSet = proto.setAttribute;
  proto.setAttribute = function (name, value) {
    if (String(name).toLowerCase() === "src") {
      value = remap(value);
      if (!value) value = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    }
    return origSet.call(this, name, value);
  };

  function streamMode() {
    var b = document.body;
    if (!b) return false;
    return b.classList.contains("mode-night") ||
           b.classList.contains("mode-stream");
  }

  var STAR_SEED = [];
  (function makeStars() {
    var i;
    for (i = 0; i < 90; i++) {
      STAR_SEED.push({
        x: Math.random(),
        y: Math.random(),
        r: Math.random() < 0.18 ? 1.4 : 0.7,
        a: 0.22 + Math.random() * 0.55
      });
    }
  })();

  function paintVoid(ctx) {
    var c = ctx.canvas;
    var w = c.width;
    var h = c.height;
    var t = (Date.now() % 5400) / 5400;
    var pulse = 0.55 + 0.45 * Math.sin(t * Math.PI * 2);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#030303";
    ctx.fillRect(0, 0, w, h);
    var g = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.08, w * 0.5, h * 0.5, Math.min(w, h) * 0.72);
    g.addColorStop(0, "rgba(18,14,10,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    var i, s;
    for (i = 0; i < STAR_SEED.length; i++) {
      s = STAR_SEED[i];
      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255," + (s.a * pulse).toFixed(3) + ")";
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function isFullClear(ctx, x, y, w, h) {
    var c = ctx.canvas;
    return x <= 2 && y <= 2 && w >= c.width - 4 && h >= c.height - 4;
  }

  function wrapCtx(ctx) {
    if (!ctx || ctx.__councilArt) return ctx;
    ctx.__councilArt = true;
    var fillRect = ctx.fillRect.bind(ctx);
    var clearRect = ctx.clearRect.bind(ctx);
    var drawImage = ctx.drawImage.bind(ctx);
    var fillText = ctx.fillText.bind(ctx);
    var strokeText = ctx.strokeText.bind(ctx);

    ctx.fillRect = function (x, y, w, h) {
      if (streamMode() && isFullClear(ctx, x, y, w, h)) {
        paintVoid(ctx);
        return;
      }
      return fillRect(x, y, w, h);
    };
    ctx.clearRect = function (x, y, w, h) {
      if (streamMode() && isFullClear(ctx, x, y, w, h)) {
        paintVoid(ctx);
        return;
      }
      return clearRect(x, y, w, h);
    };
    ctx.drawImage = function (img) {
      if (streamMode() && img) {
        var src = "";
        try { src = String(img.src || img.currentSrc || ""); } catch (e) { src = ""; }
        if (/chamber|satoshi-table|login-council|hive-egg/i.test(src)) return;
        if (img.naturalWidth > 900 && img.naturalHeight > 600 && arguments.length >= 5) {
          var dw = Number(arguments[arguments.length === 5 ? 3 : 7] || 0);
          var dh = Number(arguments[arguments.length === 5 ? 4 : 8] || 0);
          if (dw >= ctx.canvas.width * 0.72 && dh >= ctx.canvas.height * 0.72) return;
        }
      }
      return drawImage.apply(ctx, arguments);
    };
    function muteCopy(text) {
      var t = String(text || "");
      return /HIT\s*RATE|ACC%|WR%|\bMISS\b|\bHITS?\b|ACCURACY|L20|L50|P&L|CALL ACCURACY/i.test(t);
    }
    ctx.fillText = function (text) {
      if (streamMode() && muteCopy(text)) return;
      return fillText.apply(ctx, arguments);
    };
    ctx.strokeText = function (text) {
      if (streamMode() && muteCopy(text)) return;
      return strokeText.apply(ctx, arguments);
    };
    return ctx;
  }

  var origGet = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    var ctx = origGet.apply(this, arguments);
    if (type === "2d" && this && this.id === "roundtable") wrapCtx(ctx);
    return ctx;
  };

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/floor-art.css?v=" + encodeURIComponent(BUILD);
  document.head.appendChild(link);

  function labelStreamTab() {
    var tab = document.getElementById("tabNight");
    if (!tab) return;
    tab.textContent = "Stream";
    tab.title = "24/7 broadcast surface — art-first table for X / YouTube / Twitch / OBS. Full desk stays on Floor, Table, Charts, and the rest.";
  }

  function stamp() {
    if (document.getElementById("councilBuildStamp")) return;
    var el = document.createElement("div");
    el.id = "councilBuildStamp";
    el.textContent = BUILD;
    el.style.cssText = "position:fixed;right:10px;bottom:8px;z-index:90;font:10px/1 Share Tech Mono,monospace;letter-spacing:.12em;color:rgba(212,179,106,.55);pointer-events:none";
    document.body.appendChild(el);
  }

  function bootUi() {
    labelStreamTab();
    stamp();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootUi);
  } else {
    bootUi();
  }

  console.info("Satoshi’s Council · build " + BUILD + " · desk + stream split");
})();
