/* Satoshi's Council — Kalshi SWAP / WHIP engine (client-side, paper-safe).
 *
 * Watches the thin poll stream and derives, per seat, whether it is CLEAN or
 * itchy about leaving its pick: WATCH -> ARMED -> SWAPPED, and CHURN LOCK when
 * a seat swaps twice in one Kalshi hour. Market-level WHIP when the contract
 * keeps thrashing the same cent band. Nothing new is fetched or exposed — it is
 * read entirely from window.state (direction/confidence/up_pct), so it adds no
 * surface the poll allowlist doesn't already carry.
 *
 * The table stays quiet by default. Two marks only: a gold halo (itchy) and a
 * broken halo (locked). Everything else — why, charts, FROM->TO — lives in the
 * left inspector after a click, and one line per real change goes to the Room.
 *
 * Exposes window.CouncilSwap.
 */
(function () {
  "use strict";

  var GOLD = "240,193,74";
  var CYAN = "0,232,255";

  // Tuning — kept tight so halos are rare and legible (the 2-second test).
  var PERSIST_POLLS = 2;    // a new lean must hold this many polls to be "official"
  var WATCH_CONF = 34;      // leaning but conviction thinning
  var ARMED_CONF = 22;      // one nudge from letting go
  var SWAPPED_HOLD_MS = 90000;  // keep the just-swapped halo this long
  var EVENT_MS = 650;       // one-shot rim-light duration
  var WHIP_BAND = [46, 54]; // the cent band we call "the same band"
  var WHIP_CROSSINGS = 4;   // crossings in one hour to call the hour whippy

  // Chart screens each marquee seat actually reads (spec, keyed by callsign).
  var CHARTS = {
    WICK:    { lines: ["BTC 15m primary", "5m echo", "daily PDH / PDL", "volume: wick bar vs body"],
               feeds: ["BTC 15m", "5m", "daily"] },
    TAPE:    { lines: ["spot bid / ask", "time & sales", "cumulative delta 5m", "offer walls"],
               feeds: ["spot", "T&S", "delta"] },
    ORACLE:  { lines: ["daily CRT breaker", "4H delivery", "session open", "FVG", "weekly", "15m only for hunt vs HTF"],
               feeds: ["daily", "4H", "weekly"] },
    SATOSHI: { lines: ["family votes", "Chair Tape 24h", "THE BOOK depth", "huddle weights", "no single chart"],
               feeds: ["votes", "tape", "book"] },
    CHAIR:   { lines: ["family votes", "Chair Tape 24h", "THE BOOK depth", "huddle weights", "no single chart"],
               feeds: ["votes", "tape", "book"] },
    GUARDIAN:{ lines: ["stop distance $ and %", "liquidity above / below", "Monday paper", "24h HIT / MISS", "chart only for the kill line"],
               feeds: ["stops", "liq", "24h"] },
    WARDEN:  { lines: ["stop distance $ and %", "liquidity above / below", "Monday paper", "24h HIT / MISS", "chart only for the kill line"],
               feeds: ["stops", "liq", "24h"] },
    APPRENTICE:{ lines: ["the same 15m WICK reads", "WICK's open call", "last logged miss", "no private chart"],
               feeds: ["15m", "log"] }
  };

  // Canonical warning copy (spec). Keyed callsign+state; falls back to generic.
  var COPY = {
    "WICK|WATCH":     "SWAP WATCH — hunt is still the read. Next 15m close through the high and I fade my own fade.",
    "TAPE|WATCH":     "SWAP WATCH — absorb is thinning. Not off the lean yet.",
    "TAPE|ARMED":     "SWAP ARMED — offer is walking. Two more hits and I am off the bid.",
    "GUARDIAN|ARMED": "SWAP ARMED — kill line is one close. We do not need a hero print.",
    "WARDEN|ARMED":   "SWAP ARMED — kill line is one close. We do not need a hero print.",
    "ORACLE|SWAPPED": "SWAPPED — daily breaker lost on the close.",
    "SATOSHI|SWAPPED":"SWAPPED logged. Gavel stays down until the whip stops.",
    "CHAIR|SWAPPED":  "SWAPPED logged. Gavel stays down until the whip stops.",
    "GUARDIAN|LOCK":  "CHURN LOCK — two tickets on a contract that cannot pick a side. Hands off.",
    "WARDEN|LOCK":    "CHURN LOCK — two tickets on a contract that cannot pick a side. Hands off.",
    "APPRENTICE|LOCK":"Locked. I wanted a third take. That is why I am muted.",
    "SATOSHI|WHIP":   "WHIP TAPE — hour crossed 48/52 four times. New leans need a close, not a tick.",
    "CHAIR|WHIP":     "WHIP TAPE — hour crossed 48/52 four times. New leans need a close, not a tick.",
    "ORACLE|WHIP":    "I do not swap a daily level because 51¢ blinked."
  };

  var NAMES = {
    candle_btc: "WICK", candle_eth: "WICK", volume: "PULSE", momentum: "DRIFT",
    orderflow: "TAPE", funding: "CARRY", volatility: "VOLT", oi_pressure: "CHAIN",
    odds: "ODDS", session_tod: "CLOCK", whale: "WHALE", quorum: "QUORUM",
    panic: "FADE", cheap: "CHEAP", spotlag: "VEL", exhaust: "EXHAUST",
    news: "WIRE", liq: "CASCADE", regime: "ORBIT", streak: "STREAK",
    strike: "STRIKE", guardian: "WARDEN", law: "LAW", leader: "SATOSHI", chair: "SATOSHI"
  };
  var TITLES = {
    candle_btc: "Bitcoin Pattern Specialist", orderflow: "Book Walker", volume: "Flow Reader",
    momentum: "Trend Scout", funding: "Rate Oracle", guardian: "System Guard",
    whale: "Whale Tape", cheap: "Value Side", panic: "Panic Fade", regime: "Regime Watch",
    liq: "Liq Cluster", exhaust: "Run Fade", odds: "Market Skew", volatility: "Vol Scout",
    oi_pressure: "OI Pressure", streak: "Path Reader", strike: "Strike Scout",
    session_tod: "Session Clock", spotlag: "Spot Lag", news: "Sentiment Desk", quorum: "Floor Count"
  };

  function callsign(name) { return NAMES[name] || String(name || "").toUpperCase(); }
  function lane(name) { return TITLES[name] || "reads its own lane"; }
  function norm(dir) {
    var u = String(dir || "WAIT").toUpperCase();
    if (u.indexOf("UP") === 0 || u === "YES" || u === "ABOVE" || u === "LONG") return "UP";
    if (u.indexOf("DOWN") === 0 || u === "NO" || u === "BELOW" || u === "SHORT") return "DOWN";
    return "WAIT"; // WAIT, SWAP (mid-flip), unknown
  }
  function hourBucket() { return Math.floor(Date.now() / 3600000); }
  function leanWord(side) { return side === "UP" ? "LEAN LONG" : side === "DOWN" ? "LEAN SHORT" : "WAIT"; }
  // Kalshi implied probability of a given side, from the poll's up_pct/down_pct.
  function sideProb(side, m) {
    m = m || {};
    var up = Number(m.up_pct);
    if (!isFinite(up)) return null;
    var dn = isFinite(Number(m.down_pct)) ? Number(m.down_pct) : (100 - up);
    if (side === "UP") return Math.round(up);
    if (side === "DOWN") return Math.round(dn);
    return null; // WAIT — no side to price
  }

  // ---- state ----------------------------------------------------------------
  var SEATS = {};        // name -> record
  var LASTMKT = {};      // latest market block, for on-demand Kalshi deltas
  var EVENTS = [];       // room-tape queue of real state changes
  var HOUR = hourBucket();
  var MK = { crossings: 0, lastBand: null, whip: false, whipAnnounced: false, hour: HOUR };

  function rec(name) {
    if (!SEATS[name]) {
      SEATS[name] = { official: null, pend: null, pendN: 0, swaps: 0, hour: HOUR,
        state: "CLEAN", from: null, to: null, ts: 0, why: "", conf: 0, event: null, eventAt: 0,
        // Call P&L in Kalshi terms: the color a seat is in, the market-implied
        // probability of THAT side the moment they picked it (entryKalshi), where
        // that side sits now (nowKalshi), and the delta the market has moved
        // toward/against the call. DOWN picked at 50c, DOWN now 80c => +30.
        flipDir: null, flipTs: 0, entryKalshi: null, nowKalshi: null, delta: null };
    }
    return SEATS[name];
  }
  function fire(r, kind) { r.event = kind; r.eventAt = Date.now(); }
  function push(name, kind, text) { EVENTS.push({ seat: name, call: callsign(name), kind: kind, text: text, at: Date.now() }); if (EVENTS.length > 30) EVENTS.shift(); }

  function copyFor(name, state, fromTo, timeStr) {
    var key = callsign(name) + "|" + state;
    if (COPY[key]) {
      if (state === "SWAPPED" && fromTo) return COPY[key] + " (" + fromTo + (timeStr ? " " + timeStr : "") + ")";
      return COPY[key];
    }
    if (state === "WATCH") return "SWAP WATCH — thinking about leaving the pick.";
    if (state === "ARMED") return "SWAP ARMED — one print from flipping.";
    if (state === "SWAPPED") return "SWAPPED" + (fromTo ? " — " + fromTo + (timeStr ? " " + timeStr : "") : "") + ".";
    if (state === "LOCK") return "CHURN LOCK — two swaps this hour. Muted until the hour settles.";
    return "";
  }

  // ---- observe: fold one poll into the state --------------------------------
  function observe(state) {
    state = state || window.state || {};
    var now = hourBucket();
    if (now !== HOUR) {   // the hour settled — swaps and locks clear
      HOUR = now;
      Object.keys(SEATS).forEach(function (k) { var r = SEATS[k]; r.swaps = 0; r.hour = now; r.state = "CLEAN"; r.from = r.to = null; r.event = null; });
      MK.crossings = 0; MK.whip = false; MK.whipAnnounced = false; MK.hour = now; MK.lastBand = null;
    }
    var mkt = state.market || {};
    LASTMKT = mkt;
    var agents = (state.agents || []).filter(function (a) {
      return a && a.agent_name && a.agent_name !== "leader" && !a.sub && String(a.category || "") !== "health";
    });
    agents.forEach(function (a) {
      var r = rec(a.agent_name);
      var side = norm(a.direction);
      var conf = Math.max(0, Math.min(100, Math.round(a.confidence || 0)));
      r.conf = conf;
      if (r.official === null) {
        // first sighting: treat the current color as its entry point
        r.official = side; r.pend = null; r.pendN = 0;
        r.flipDir = side; r.flipTs = Date.now(); r.entryKalshi = sideProb(side, mkt);
        return;
      }

      if (side !== r.official) {
        // candidate swap — must persist to count as official
        if (r.pend === side) r.pendN++; else { r.pend = side; r.pendN = 1; }
        if (r.pendN >= PERSIST_POLLS) {
          var from = r.official, to = side;
          r.from = from; r.to = to; r.ts = Date.now(); r.official = to; r.pend = null; r.pendN = 0; r.swaps++;
          r.flipDir = to; r.flipTs = r.ts; r.entryKalshi = sideProb(to, mkt);  // Kalshi price of the new side at the flip
          var ft = leanWord(from) + " → " + leanWord(to);
          var tstr = fmtTime(r.ts);
          if (r.swaps >= 2) {
            if (r.state !== "LOCK") { r.state = "LOCK"; r.why = copyFor(a.agent_name, "LOCK"); fire(r, "lock"); push(a.agent_name, "lock", r.why); }
          } else {
            r.state = "SWAPPED"; r.why = copyFor(a.agent_name, "SWAPPED", ft, tstr); fire(r, "swapped");
            push(a.agent_name, "swapped", r.why);
          }
        } else if (r.state !== "LOCK") {
          // sliding toward a flip but not committed = ARMED
          r.state = "ARMED"; r.why = copyFor(a.agent_name, "ARMED");
          if (r.event !== "armed") fire(r, "armed");
        }
      } else {
        // holding the pick
        r.pend = null; r.pendN = 0;
        if (r.state === "LOCK") return;  // stays locked until the hour resets
        if (r.state === "SWAPPED" && Date.now() - r.ts < SWAPPED_HOLD_MS) return; // let the halo linger
        if (side !== "WAIT" && conf <= ARMED_CONF) { r.state = "ARMED"; r.why = copyFor(a.agent_name, "ARMED"); }
        else if (side !== "WAIT" && conf <= WATCH_CONF) { r.state = "WATCH"; r.why = copyFor(a.agent_name, "WATCH"); }
        else { r.state = "CLEAN"; r.why = ""; }
      }
    });

    observeMarket(state);
    updateChip(state);
  }

  function observeMarket(state) {
    var m = (state && state.market) || {};
    var up = Number(m.up_pct);
    if (!isFinite(up)) return;
    var band = up < WHIP_BAND[0] ? "lo" : up > WHIP_BAND[1] ? "hi" : "mid";
    if (band !== "mid" && MK.lastBand && band !== MK.lastBand && MK.lastBand !== "mid") MK.crossings++;
    if (band !== "mid") MK.lastBand = band;
    if (MK.crossings >= WHIP_CROSSINGS) {
      MK.whip = true;
      if (!MK.whipAnnounced) {
        MK.whipAnnounced = true;
        push("leader", "whip", COPY["SATOSHI|WHIP"]);
      }
    }
  }

  function fmtTime(ms) {
    var d = new Date(ms || Date.now());
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  // ---- summary + header chip ------------------------------------------------
  function summary() {
    var halo = 0, lock = 0;
    Object.keys(SEATS).forEach(function (k) {
      var s = SEATS[k].state;
      if (s === "LOCK") lock++;
      else if (s === "WATCH" || s === "ARMED" || s === "SWAPPED") halo++;
    });
    return { halo: halo, lock: lock, whip: MK.whip };
  }

  function chairState(state) {
    state = state || window.state || {};
    var d = state.decision || {};
    if (d.lockdown || (state.leaders && state.leaders.lockdown)) return "LOCK";
    if (MK.whip) return "WAIT"; // whippy hour defaults the Chair to WAIT
    return norm(d.direction) === "WAIT" ? "WAIT" : leanWord(norm(d.direction));
  }

  function updateChip(state) {
    var chip = document.getElementById("whipChip");
    if (!chip) return;
    var s = summary();
    var chair = chairState(state);
    if (!s.halo && !s.lock && !s.whip) { chip.hidden = true; chip.textContent = ""; return; }
    var bits = [];
    if (s.whip) bits.push("WHIP");
    if (s.halo) bits.push(s.halo + " HALO");
    if (s.lock) bits.push(s.lock + " LOCK");
    bits.push("Chair " + chair);
    chip.textContent = bits.join(" · ");
    chip.className = "whip-chip" + (s.whip ? " whip" : "");
    chip.hidden = false;
  }

  // ---- canvas marks (called from drawArt's seat loop) -----------------------
  // ctx: 2D context, (x,y) seat center in canvas CSS px, r seat radius.
  function drawSeatMark(ctx, name, x, y, r, nowMs) {
    var rr = SEATS[name];
    if (!ctx || !rr) return;
    var st = rr.state;
    if (st === "CLEAN") { maybeEvent(ctx, rr, x, y, r, nowMs); return; }
    ctx.save();
    var ringR = r + 9;
    if (st === "LOCK") {
      // broken halo + bar across + muted portrait
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(x, y, ringR, -Math.PI / 2 + 0.9, -Math.PI / 2 - 0.9 + Math.PI * 2);
      ctx.strokeStyle = "rgba(150,160,175,0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
      // thin bar crossing it
      ctx.beginPath();
      ctx.moveTo(x - ringR, y + ringR * 0.55);
      ctx.lineTo(x + ringR, y - ringR * 0.55);
      ctx.strokeStyle = "rgba(180,190,205,0.75)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // desaturate: mute disc over the portrait
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(18,22,30,0.5)";
      ctx.fill();
    } else {
      // gold halo: 270deg ring, gap at the top, barely breathing
      var breathe = 0.82 + 0.06 * Math.sin((nowMs || 0) / 1400);
      ctx.beginPath();
      ctx.arc(x, y, ringR, -Math.PI / 2 + Math.PI / 4, -Math.PI / 2 - Math.PI / 4 + Math.PI * 2);
      ctx.strokeStyle = "rgba(" + GOLD + "," + breathe.toFixed(3) + ")";
      ctx.lineWidth = 2.2;
      ctx.stroke();
      if (st === "ARMED") {
        // one noon tick that breathes once every ~2s
        var tick = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin((nowMs || 0) / 1000 * Math.PI));
        ctx.beginPath();
        ctx.moveTo(x, y - ringR - 1);
        ctx.lineTo(x, y - ringR - 5);
        ctx.strokeStyle = "rgba(" + GOLD + "," + tick.toFixed(3) + ")";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.restore();
    maybeEvent(ctx, rr, x, y, r, nowMs);
  }

  // one-shot rim light on a fresh transition
  function maybeEvent(ctx, rr, x, y, r, nowMs) {
    if (!rr.event) return;
    var t = (Date.now() - rr.eventAt) / EVENT_MS;
    if (t >= 1) { rr.event = null; return; }
    ctx.save();
    var ringR = r + 9;
    if (rr.event === "armed") {
      // one cyan edge lick sweeping the right side
      var a = Math.sin(t * Math.PI);
      ctx.beginPath();
      ctx.arc(x, y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 1.2 * t);
      ctx.strokeStyle = "rgba(" + CYAN + "," + (a * 0.9).toFixed(3) + ")";
      ctx.lineWidth = 2.4; ctx.stroke();
    } else if (rr.event === "swapped") {
      // one gold pass left to right
      var a2 = Math.sin(t * Math.PI);
      ctx.beginPath();
      ctx.arc(x, y, ringR, Math.PI - Math.PI * t, Math.PI + Math.PI * t);
      ctx.strokeStyle = "rgba(" + GOLD + "," + (a2 * 0.95).toFixed(3) + ")";
      ctx.lineWidth = 2.6; ctx.stroke();
    } else if (rr.event === "lock") {
      // gold drains out of the portrait -> gray
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(30,26,14," + (0.5 * t).toFixed(3) + ")";
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- inspector data (7 sections, spec order) ------------------------------
  function inspector(name) {
    var state = window.state || {};
    var agents = (state.agents || []);
    var a = null;
    for (var i = 0; i < agents.length; i++) { if (agents[i].agent_name === name) { a = agents[i]; break; } }
    if (!a) return null;
    var cs = callsign(name);
    var side = norm(a.direction);
    var conf = Math.max(0, Math.min(100, Math.round(a.confidence || 0)));
    var r = rec(name);
    var charts = CHARTS[cs] || { lines: [lane(name) + " — reads it off the 15m and the Kalshi cent."], feeds: ["15m", "cent"] };

    // section 4 — live read on those charts
    var lvl = levelWord(state);
    var liveRead = a.reasoning
      ? a.reasoning
      : (side === "WAIT"
          ? "Nothing clean on the screens yet — price sitting " + lvl + "."
          : (side === "UP" ? "Reading strength into " + lvl + " and staying with it." : "Reading weakness off " + lvl + " and leaning into it."));

    // section 6 — what other seats see
    var agree = 0, fight = 0;
    agents.forEach(function (o) {
      if (o.agent_name === name || o.sub || o.agent_name === "leader") return;
      var os = norm(o.direction);
      if (os === "WAIT" || side === "WAIT") return;
      if (os === side) agree++; else fight++;
    });
    var others = side === "WAIT"
      ? "No pick to defend — watching who commits first."
      : (agree + " with " + cs + ", " + fight + " against.") + (fight > agree ? " Outnumbered — needs the tape to prove it." : " Floor is leaning the same way.");

    // section 7 — what they want the Chair to know
    var ask = side === "WAIT" ? "WAIT"
      : (conf <= ARMED_CONF ? "STAND DOWN" : leanWord(side));
    var invalid = side === "UP" ? "Invalid on a 15m close back under " + lvl + "."
      : side === "DOWN" ? "Invalid on a 15m close back over " + lvl + "."
      : "Takes a close, not a tick, to move me.";

    return {
      who: { name: cs, lane: lane(name) },
      warn: r.state === "CLEAN" ? null : {
        state: r.state, pick: leanWord(r.official || side),
        fromTo: r.from ? (leanWord(r.from) + " → " + leanWord(r.to)) : null,
        time: r.ts ? fmtTime(r.ts) : null, why: r.why, swaps: r.swaps
      },
      charts: charts.lines, feeds: charts.feeds,
      liveRead: liveRead,
      thinking: { conf: conf, text: side === "WAIT"
        ? "I stay quiet until the screens give me one. No edge, no call."
        : ("I'm " + conf + " on this. " + (conf <= ARMED_CONF ? "Barely — one more print the other way and I'm gone." : "Holding it while the read holds.")) },
      others: others,
      ask: { call: ask, invalidation: invalid },
      flip: flipInfo(name)
    };
  }

  function levelWord(state) {
    var u = Number(((state || {}).market || {}).up_pct);
    if (!isFinite(u)) return "the mid";
    if (u >= 66) return "the top of the range";
    if (u <= 34) return "the lows";
    return "the pivot";
  }

  function flipInfo(name) {
    var r = SEATS[name];
    if (!r || !r.flipDir || r.flipDir === "WAIT") return null;
    var now = sideProb(r.flipDir, LASTMKT);
    var entry = r.entryKalshi;
    var delta = (now != null && entry != null) ? (now - entry) : null;
    return { dir: r.flipDir, entry: entry, now: now, delta: delta };
  }
  function seatState(name) { return SEATS[name] || { state: "CLEAN" }; }
  function drainEvents() { var e = EVENTS; EVENTS = []; return e; }
  function marketWhip() { return MK.whip; }

  window.CouncilSwap = {
    observe: observe,
    drawSeatMark: drawSeatMark,
    summary: summary,
    inspector: inspector,
    seatState: seatState,
    drainEvents: drainEvents,
    marketWhip: marketWhip,
    chairState: chairState,
    callsign: callsign,
    // Call P&L in Kalshi terms: {dir, entry, now, delta}. entry = the market
    // probability of the seat's side when it picked that color; now = where that
    // side sits currently; delta = how far the market has moved toward (+) or
    // against (-) the call. null for WAIT or before a priced pick.
    flip: flipInfo
  };
})();
