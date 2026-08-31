/* THE ROOM — a full-viewport war room that learned to talk.
 *
 * Self-contained: reads window.state (the thin poll), owns #warRoom, exposes
 * window.CouncilRoom.{start,stop}. Every CALL shown is the seat's real signal;
 * the table talk around it is dramatized flavor, paper-serious, never carnival.
 */
(function () {
  "use strict";

  var NAMES = {
    candle_btc: "WICK", candle_eth: "WICK", volume: "PULSE", momentum: "DRIFT",
    orderflow: "TAPE", funding: "CARRY", volatility: "VOLT", oi_pressure: "CHAIN",
    odds: "ODDS", session_tod: "CLOCK", whale: "WHALE", quorum: "QUORUM",
    panic: "FADE", cheap: "CHEAP", spotlag: "VEL", exhaust: "EXHAUST",
    news: "WIRE", liq: "CASCADE", regime: "ORBIT", streak: "STREAK",
    strike: "STRIKE", guardian: "WARDEN", law: "LAW"
  };
  // Portrait per seat (falls back to a letter chip if missing).
  function portrait(key) {
    if (!key) return "";
    return "/portraits/" + key + ".webp";
  }

  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function chance(p) { return Math.random() < p; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function dirClass(d) {
    var u = String(d || "WAIT").toUpperCase();
    if (u === "UP" || u === "YES" || u === "ABOVE") return "UP";
    if (u === "DOWN" || u === "NO" || u === "BELOW") return "DOWN";
    return "WAIT";
  }

  // ---- live snapshot helpers -------------------------------------------------
  function snap() {
    var st = window.state || {};
    var agents = (st.agents || []).filter(function (a) {
      return a && a.agent_name && a.agent_name !== "leader" && !a.sub;
    });
    var d = st.decision || {};
    var m = st.market || {};
    var up = Number(m.up_pct);
    return {
      agents: agents,
      decision: d,
      dir: dirClass(d.direction),
      conf: Math.round(d.confidence || 0),
      lockdown: !!(d.lockdown || (st.leaders && st.leaders.lockdown)),
      chair: (st.leader_name || "CHAIR"),
      upPct: isFinite(up) ? up : null,
      price: m.price,
      mins: (m.mins_left != null ? m.mins_left : (m.seconds_left != null ? Math.round(m.seconds_left / 60) : null)),
      secs: m.seconds_left,
      windowLabel: (String(st.asset || "").toLowerCase() === "eth") ? "ETH 1H" : "BTC 15m",
      feedsDead: !((st.health || {}).binance || (st.health || {}).coinbase) && !(st.health || {}).kalshi,
      why: d.family_why || d.why || d.summary || ""
    };
  }
  // Where price sits in the window, from Kalshi implied prob (a real number).
  function levelWord(s) {
    var u = s.upPct;
    if (u == null) return pick(["the mid", "no-man's land", "the middle of the range"]);
    if (u >= 66) return pick(["prior-day high", "the top of the range", "the highs"]);
    if (u <= 34) return pick(["the session low", "the bottom of the range", "the lows"]);
    return pick(["the mid", "dead center", "the pivot"]);
  }
  function activity(s) {
    // Dead tape = everyone WAIT and price parked near the middle.
    var leaning = s.agents.filter(function (a) { return dirClass(a.direction) !== "WAIT"; }).length;
    var mid = s.upPct == null ? true : (s.upPct > 40 && s.upPct < 60);
    if (leaning === 0 && mid) return "dead";
    if (leaning >= 3) return "hot";
    return "slow";
  }

  // ---- voices: each seat reads its own thing --------------------------------
  function readFor(agent, s) {
    var key = agent.agent_name;
    var d = dirClass(agent.direction);
    var lvl = levelWord(s);
    var yes = (function () {
      var y = Number((s.decision && s.decision.yes_ask));
      return isFinite(y) ? Math.round(y) : null;
    })();

    if (key === "candle_btc" || key === "candle_eth") { // WICK — range-aware candle reads
      if (d === "WAIT") return pick([
        "Long upper wick into " + lvl + ". Body closed mid. Volume died on the poke. That's a hunt, not a break.",
        "Doji on the " + lvl + " retest — nobody committed. I need a close, not a wick.",
        "Lower wick holds but the close is soft. Sellers aren't done. I sit.",
        "Inside bar at " + lvl + ". No range, no read. Waiting for the expansion."
      ]);
      if (d === "UP") return pick([
        "Higher low off " + lvl + ", clean body close, volume stepped in. That holds — I lean up.",
        "Reclaim candle at " + lvl + ". Wick swept the stops, body closed strong. Up until it fails the low.",
        "Break-and-hold over " + lvl + ". Kills if we close back inside."
      ]);
      return pick([
        "Lower high, body closed under the mid, volume on the down bar. That breaks — I'm short the poke.",
        "Failed push into " + lvl + ", long upper wick, no follow-through. Down until it reclaims.",
        "Rejection candle at " + lvl + ". Kills if buyers close it back above."
      ]);
    }
    if (key === "volume") return d === "WAIT"
      ? pick(["Flow's thin — a lot of ticks, no size behind them.", "Volume died on the last push. Decoration, not conviction."])
      : pick(["Volume stepped in on the " + d.toLowerCase() + " bar — that's real.", "Size is finally showing. I'm with the " + (d === "UP" ? "buyers" : "sellers") + "."]);
    if (key === "momentum") return d === "WAIT"
      ? pick(["Trend's flat — both sides poking, nobody winning.", "No slope here. Chop until it picks a side."])
      : pick(["Lower highs stacking — momentum rolled " + (d === "UP" ? "up" : "over") + ".", "Slope's turned " + (d === "UP" ? "up" : "down") + ". I'm with it while it lasts."]);
    if (key === "orderflow") return d === "WAIT"
      ? pick(["Bid and offer both refreshing. It's a standoff.", "Book's balanced. Nobody's tipping their hand."])
      : pick(["Bids stacking under — someone's building a position.", "Offers pulling — path of least resistance is " + d.toLowerCase() + "."]);
    if (key === "cheap") return d === "WAIT"
      ? pick(["Nothing's cheap here. Fair is fair. I pass.", "No edge in the price. I don't pay up for hope."])
      : (yes != null ? "YES at " + yes + "c is a gift if " + lvl + " holds." : pick(["Price finally dislocated — there's value on the " + (d === "UP" ? "upside" : "downside") + ".", "Cheap enough to lean " + d.toLowerCase() + " now."]));
    if (key === "funding") return pick(["Funding's calm — no crowd to squeeze.", "Rates flat. No one's overcommitted yet."]);
    if (key === "panic") return d === "WAIT" ? pick(["No capitulation. Nothing to fade.", "Move's orderly. I only fade the panic, and there isn't one."]) : "Overreaction on the " + (d === "UP" ? "flush" : "spike") + " — fading it back toward fair.";
    if (key === "exhaust") return d === "WAIT" ? "Run's not extended enough to fade." : "This leg's tired — late longs into " + lvl + ". Fading the exhaustion.";
    if (key === "spotlag") return "Spot's leading Kalshi by a hair. If it holds, the book follows.";
    if (key === "quorum") return d === "WAIT" ? "Only one family's talking. I need two before I count it." : "Two families lined up " + d.toLowerCase() + ". That's a quorum.";
    if (key === "regime") return pick(["Regime's quiet — small size, tight stops.", "Aggression's low. This is a sit-and-watch tape."]);
    if (key === "news") return pick(["Nothing on the wire that moves a 15-minute window.", "Sentiment's mid. No fear, no greed to lean on."]);
    if (key === "guardian") return s.feedsDead ? "Feeds are sick. I'm vetoing until the data's clean." : "Data's clean. No objection from me.";
    // generic
    return d === "WAIT"
      ? pick(["No edge on my read. Holding.", "Too quiet to lean. I wait."])
      : "My read's " + d.toLowerCase() + " here — not loud, but there.";
  }

  // ---- non-pattern beats -----------------------------------------------------
  var JOKES = [
    "Range so tight I can hear CLOCK breathing.",
    "Someone poke the tape — I think it flatlined.",
    "This candle's got the same open and close as my patience.",
    "We could settle this window with a coin and save the electricity.",
    "Slowest tape since the last slowest tape.",
    "If nothing prints in five minutes I'm charting my coffee.",
    "Volatility called. It's taking the window off."
  ];
  var CHATTER = [
    "Coffee's cold. So's this tape.",
    "Whose turn is it to watch the low? Mine? Fine.",
    "Two more windows and I'm calling it a session.",
    "Somebody dim the charts, the glare's brutal tonight.",
    "Rain's picking up on the glass. Fits the mood."
  ];
  var RAIL = [
    { who: "RAIJIN", key: "raijin-chair", line: "DFW's cooking down here — storms on the rail. Weather chair stays busy even when crypto naps." },
    { who: "RAIJIN", key: "raijin-chair", line: "Dallas high's the only thing moving today. Y'all want a real range, come to the weather table." },
    { who: "VITALIK", key: null, line: "ETH table's quiet. One lock an hour — that's the job. Envy the calm." },
    { who: "VITALIK", key: null, line: "You lot churn fifteen-minute windows. I sip tea and lock once." },
    { who: "ARES", key: null, line: "Kickoff in twenty. You crypto kids have fun with your candles." },
    { who: "SATOSHI", key: null, line: "Fifteen minutes a window. Blink and it's a new hand." }
  ];
  function crossTalk(speaker, s) {
    var others = s.agents.filter(function (a) { return a.agent_name !== speaker.agent_name; });
    if (!others.length) return null;
    var o = NAMES[pick(others).agent_name] || "TAPE";
    return pick([
      o + " — you seeing that lift or are you decorating?",
      o + ", back me or fade me. Don't just nod.",
      o + " said sit. " + o + " was right last window.",
      "Where you at, " + o + "? I'm not carrying this read alone.",
      o + ", quit painting the tape and give me a level."
    ]);
  }
  function roast(s) {
    return pick([
      "That's the lockdown. Two wrong. Hands down, everyone.",
      "We forced it. We paid. Quiet now.",
      "Sit on your hands. The tape doesn't owe us a win-back.",
      "Nobody hero-trades the cooldown. We wait for a clean one.",
      "Two misses. The next loud call buys the coffee."
    ]);
  }
  function nod(s) {
    return pick([
      "Chair's got it. Clean.",
      "That's a real one. I'm with it.",
      "Good lock. Now we leave it alone.",
      "No notes. That's the read."
    ]);
  }

  // ---- the beat picker -------------------------------------------------------
  var lastKey = null;
  function nextBeat(s) {
    // returns {who, key, text, dir}
    var act = activity(s);
    var seats = s.agents;
    function speaker() {
      var a = pick(seats.length ? seats : [{ agent_name: "orderflow", direction: "WAIT" }]);
      if (a.agent_name === lastKey && seats.length > 1) {
        var i = seats.indexOf(a);
        a = seats[(i + 1) % seats.length];
      }
      lastKey = a.agent_name;
      return a;
    }

    // Cooldown: roasts + quiet, wrong-callers go silent.
    if (s.lockdown && chance(0.55)) {
      var r = speaker();
      return { who: NAMES[r.agent_name] || "DESK", key: r.agent_name, text: roast(s), dir: "WAIT" };
    }
    // Rail interjection.
    if (chance(0.14)) {
      var rail = pick(RAIL);
      return { who: rail.who, key: rail.key, text: rail.line, dir: "WAIT", rail: true };
    }
    // Dead tape → jokes / chatter.
    if (act === "dead" && chance(0.6)) {
      var d = speaker();
      return { who: NAMES[d.agent_name] || "DESK", key: d.agent_name, text: pick(chance(0.5) ? JOKES : CHATTER), dir: "WAIT" };
    }
    // Nod on a confident, healthy lock (short, no parade).
    if (s.dir !== "WAIT" && s.conf >= 60 && !s.feedsDead && chance(0.25)) {
      var n = speaker();
      return { who: NAMES[n.agent_name] || "DESK", key: n.agent_name, text: nod(s), dir: s.dir };
    }
    // Cross-talk.
    if (chance(0.22)) {
      var c = speaker();
      var ct = crossTalk(c, s);
      if (ct) return { who: NAMES[c.agent_name] || "DESK", key: c.agent_name, text: ct, dir: dirClass(c.direction) };
    }
    // Default: a pattern read.
    var sp = speaker();
    return { who: NAMES[sp.agent_name] || "DESK", key: sp.agent_name, text: readFor(sp, s), dir: dirClass(sp.direction) };
  }

  // ---- scene -----------------------------------------------------------------
  var el = {}, rainCtx = null, rainDrops = [], rainRAF = 0, timer = null, callTimer = null;
  var SEAT_POS = []; // {x,y} on the table rim, %.

  function buildScene() {
    var host = document.getElementById("warRoom");
    if (!host) return false;
    // Rebuild if the scene isn't actually in the DOM — a stale __built flag
    // with an emptied host (view re-rendered, el.* references gone) is exactly
    // what left the Room a blank black panel.
    if (host.__built && host.childElementCount > 0 && el.seats && host.contains(el.seats)) return true;
    host.__built = true;
    host.innerHTML =
      '<canvas id="warRain" class="war-rain"></canvas>' +
      '<div class="war-charts" id="warCharts"></div>' +
      '<div class="war-ticker" id="warTicker"><div class="war-ticker-row" id="warTickerRow"></div></div>' +
      '<div class="war-stage">' +
        '<div class="war-table" id="warTable">' +
          '<div class="war-table-rings"></div>' +
          '<div class="war-call" id="warCall"></div>' +
          '<div class="war-seats" id="warSeats"></div>' +
          '<div class="war-bubble" id="warBubble" hidden></div>' +
        '</div>' +
      '</div>' +
      '<div class="war-transcript" id="warTranscript" aria-live="polite"></div>';
    el.charts = host.querySelector("#warCharts");
    el.seats = host.querySelector("#warSeats");
    el.bubble = host.querySelector("#warBubble");
    el.call = host.querySelector("#warCall");
    el.transcript = host.querySelector("#warTranscript");
    el.tickerRow = host.querySelector("#warTickerRow");
    el.rain = host.querySelector("#warRain");
    buildCharts();
    startRain();
    return true;
  }

  function buildCharts() {
    if (!el.charts || el.charts.childElementCount) return;
    var html = "";
    for (var i = 0; i < 10; i++) {
      var pts = [];
      var y = 20 + Math.random() * 20;
      for (var x = 0; x <= 100; x += 10) { y += (Math.random() - 0.5) * 14; y = Math.max(6, Math.min(48, y)); pts.push(x + "," + y.toFixed(1)); }
      html += '<div class="war-chart"><svg viewBox="0 0 100 54" preserveAspectRatio="none">' +
        '<polyline points="' + pts.join(" ") + '"/></svg></div>';
    }
    el.charts.innerHTML = html;
  }

  function layoutSeats(s) {
    if (!el.seats) return;
    // Every seat that made a call sits at the table — no cap. Ring gets tighter
    // and portraits shrink as the table fills so nobody is dropped.
    var seats = s.agents;
    var n = seats.length || 1;
    el.seats.className = "war-seats" + (n > 16 ? " dense2" : (n > 10 ? " dense" : ""));
    var rx = n > 16 ? 45 : 42;
    var ry = n > 16 ? 44 : 40;
    var html = "";
    SEAT_POS = [];
    for (var i = 0; i < seats.length; i++) {
      var a = seats[i];
      var ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
      var x = 50 + Math.cos(ang) * rx;
      var y = 50 + Math.sin(ang) * ry;
      SEAT_POS.push({ x: x, y: y, key: a.agent_name });
      var name = NAMES[a.agent_name] || String(a.agent_name).toUpperCase();
      var dc = dirClass(a.direction);
      var conf = Math.round(a.confidence || 0);
      html += '<div class="war-seat ' + dc + '" data-key="' + esc(a.agent_name) + '" style="left:' + x + '%;top:' + y + '%">' +
        '<span class="war-av" style="background-image:url(\'' + portrait(a.agent_name) + '\')"></span>' +
        '<span class="war-seat-name">' + esc(name) + '</span>' +
        '<span class="war-seat-call ' + dc + '">' + (dc === "WAIT" ? "WAIT" : dc + " " + conf + "%") + '</span>' +
        '</div>';
    }
    el.seats.innerHTML = html;
  }

  function paintCall(s) {
    if (!el.call) return;
    var chair = (window.state && window.state.leader_name) || s.chair || "CHAIR";
    var tag = s.lockdown ? "LOCKDOWN" : (s.dir === "WAIT" ? "WAIT" : s.dir + " " + s.conf + "%");
    el.call.className = "war-call " + s.dir + (s.lockdown ? " lock" : "");
    el.call.innerHTML =
      '<span class="wc-win">' + esc(s.windowLabel) + (s.mins != null ? ' · ' + s.mins + 'm' : '') + '</span>' +
      '<span class="wc-chair">' + esc(String(chair).toUpperCase()) + '</span>' +
      '<span class="wc-tag ' + s.dir + '">' + esc(tag) + '</span>' +
      (s.why ? '<span class="wc-why">' + esc(s.why) + '</span>' : '');
  }

  function paintTicker(s) {
    if (!el.tickerRow) return;
    var m = (window.state && window.state.market) || {};
    var bits = [
      s.windowLabel,
      s.mins != null ? (s.mins + "m to close") : "—",
      "P(up) " + (s.upPct != null ? Math.round(s.upPct) + "%" : "—"),
      "CALL " + (s.dir === "WAIT" ? "WAIT" : s.dir + " " + s.conf + "%"),
      s.feedsDead ? "FEEDS DARK" : "FEEDS LIVE",
      s.lockdown ? "LAW LOCK" : "LAW OK"
    ];
    var one = bits.map(function (b) { return '<span class="tk">' + esc(b) + '</span>'; }).join('<span class="tk-dot">·</span>');
    el.tickerRow.innerHTML = one + '<span class="tk-dot">·</span>' + one; // duplicate for seamless scroll
  }

  function speak(beat) {
    if (!el.transcript) return;
    // transcript line
    var row = document.createElement("div");
    row.className = "war-line " + (beat.rail ? "rail " : "") + beat.dir;
    row.innerHTML =
      '<span class="wl-who ' + beat.dir + '">' + esc(beat.who) + '</span>' +
      '<span class="wl-text">' + esc(beat.text) + '</span>';
    el.transcript.appendChild(row);
    while (el.transcript.childElementCount > 14) el.transcript.removeChild(el.transcript.firstChild);
    el.transcript.scrollTop = el.transcript.scrollHeight;
    // bubble over the speaking seat + glow it
    var pos = null;
    for (var i = 0; i < SEAT_POS.length; i++) if (SEAT_POS[i].key === beat.key) pos = SEAT_POS[i];
    var seats = el.seats ? el.seats.querySelectorAll(".war-seat") : [];
    for (var j = 0; j < seats.length; j++) seats[j].classList.remove("talking");
    if (pos && el.bubble) {
      var active = el.seats.querySelector('.war-seat[data-key="' + beat.key + '"]');
      if (active) active.classList.add("talking");
      el.bubble.className = "war-bubble " + beat.dir;
      el.bubble.style.left = pos.x + "%";
      el.bubble.style.top = (pos.y - 12) + "%";
      el.bubble.innerHTML = '<span class="wb-who">' + esc(beat.who) + '</span>' + esc(beat.text);
      el.bubble.hidden = false;
    } else if (el.bubble) {
      // rail voice — no seat on this table
      el.bubble.hidden = true;
    }
  }

  function startRain() {
    if (!el.rain) return;
    var c = el.rain, ctx = c.getContext("2d");
    rainCtx = ctx;
    function resize() { c.width = c.offsetWidth; c.height = c.offsetHeight; }
    resize();
    rainDrops = [];
    for (var i = 0; i < 90; i++) rainDrops.push({ x: Math.random(), y: Math.random(), l: 8 + Math.random() * 16, s: 2 + Math.random() * 3 });
    window.addEventListener("resize", resize);
    (function draw() {
      if (!rainCtx) return;
      var w = c.width, h = c.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(150,190,220,0.18)";
      ctx.lineWidth = 1;
      for (var i = 0; i < rainDrops.length; i++) {
        var d = rainDrops[i];
        var px = d.x * w, py = d.y * h;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - 2, py + d.l); ctx.stroke();
        d.y += d.s / h; d.x -= 0.2 / w;
        if (d.y > 1) { d.y = -0.05; d.x = Math.random(); }
      }
      rainRAF = requestAnimationFrame(draw);
    })();
  }
  function stopRain() { if (rainRAF) cancelAnimationFrame(rainRAF); rainRAF = 0; rainCtx = null; }

  // ---- lifecycle -------------------------------------------------------------
  var tick = 0;
  function beatOnce() {
    var s = snap();
    if (!s.agents.length) { return; }
    layoutSeats(s);       // cheap; keeps calls fresh
    paintCall(s);
    paintTicker(s);
    tick++;
    var beat = nextBeat(s);
    if (beat) speak(beat);
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    var ms = 4000 + Math.random() * 4000; // 4–8s
    timer = setTimeout(function () { beatOnce(); schedule(); }, ms);
  }
  function start() {
    if (!buildScene()) return;
    var s = snap();
    layoutSeats(s); paintCall(s); paintTicker(s);
    if (el.transcript && !el.transcript.childElementCount) { beatOnce(); beatOnce(); }
    if (callTimer) clearInterval(callTimer);
    callTimer = setInterval(function () { var s2 = snap(); layoutSeats(s2); paintCall(s2); paintTicker(s2); }, 2000);
    schedule();
  }
  function stop() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (callTimer) { clearInterval(callTimer); callTimer = null; }
    stopRain();
  }

  window.CouncilRoom = { start: start, stop: stop };
})();
