/* Cookie-gated Follower desk. Not shipped in the public document. */
(function () {
  if (window.__followerBundle) return;
  window.__followerBundle = true;

  function $(id) { return document.getElementById(id); }

  function placeTab() {
    const tab = $("tabFollower");
    const view = $("followerView");
    const tabs = document.querySelector(".mode-tabs");
    const host = $("chartsView") || $("settingsView");
    if (tab && tabs && !tab.__placed) {
      tab.__placed = true;
      const settings = $("tabSettings");
      if (settings && settings.parentNode === tabs) tabs.insertBefore(tab, settings);
      else tabs.appendChild(tab);
    }
    if (view && host && view.parentNode !== host.parentNode) {
      host.parentNode.insertBefore(view, host);
    }
    const ext = $("deskExtBtn");
    if (ext) ext.classList.add("hidden");
  }

  function lockCard(st, chair, asset) {
    const d = (st && st.decision) || {};
    const lc = (st && (st.locked_call || d.locked_call)) || {};
    const locked = !!(lc && lc.locked && (lc.direction === "UP" || lc.direction === "DOWN"));
    const dir = locked ? lc.direction : (d.direction || "WAIT");
    const conf = locked ? (lc.confidence || d.confidence) : (d.confidence || "—");
    const odds = lc.entry_odds != null ? lc.entry_odds : (lc.up_pct != null ? lc.up_pct : d.entry_odds);
    const ev = lc.ev_cents != null ? lc.ev_cents : d.ev_cents;
    const pf = lc.p_finish != null ? lc.p_finish : d.p_finish;
    const strike = (st && st.market && st.market.floor_strike) || lc.floor_strike;
    const mins = (st && st.lock_timeline && st.lock_timeline.mins_left);
    const bits = [];
    if (odds != null) bits.push(Number(odds).toFixed(0) + "¢");
    if (conf != null && conf !== "—") bits.push(conf + "%");
    if (pf != null) bits.push("P " + Number(pf).toFixed(2));
    if (ev != null) bits.push("EV " + Number(ev).toFixed(1) + "¢");
    if (strike != null) bits.push("K " + Number(strike).toLocaleString());
    if (mins != null) bits.push(Number(mins).toFixed(0) + "m left");
    return (
      '<article class="follower-card-lock">' +
        '<div class="fc-chair">' + chair + " · " + asset + "</div>" +
        '<div class="fc-dir ' + dir + '">' + (locked ? ("LOCKED " + dir) : dir) + "</div>" +
        '<div class="fc-meta">' + (locked ? "FOLLOW THIS" : "No lock") +
          (bits.length ? "<br/>" + bits.join(" · ") : "") + "</div>" +
      "</article>"
    );
  }

  function renderFollower() {
    const host = $("followerBoards");
    if (!host) return;
    const state = window.state || {};
    const btc = state.btc || (state.tables && state.tables.bitcoin) || state || {};
    const eth = state.eth || (state.tables && state.tables.ethereum) || {};
    host.innerHTML = lockCard(btc, "SATOSHI", "BTC") + lockCard(eth, "VITALIK", "ETH");
  }
  window.renderFollower = renderFollower;

  window.__deskModeCycle = function () {
    return ["art", "dashboard", "bots", "ranks", "paper", "follower", "charts", "settings"];
  };

  function paintLive(d) {
    const el = $("followerLiveState");
    const wait = $("followerArmWait");
    if (!el) return;
    const on = !!(d && d.live);
    el.textContent = on ? (d.armed ? "LIVE ARMED" : "LIVE ARMING") : "LIVE OFF";
    el.classList.toggle("on", on);
    if (wait) {
      const s = d && d.arm_wait_s ? Math.ceil(Number(d.arm_wait_s)) : 0;
      wait.textContent = s > 0 ? ("wait " + s + "s") : "";
    }
  }

  async function status() {
    try {
      const r = await fetch("/api/follower/status", { credentials: "same-origin" });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  async function heartbeat() {
    try {
      await fetch("/api/follower/heartbeat", { method: "POST", credentials: "same-origin" });
    } catch (e) {}
  }

  function dropSession() {
    document.body.classList.remove("follower-unlocked");
    const tab = $("tabFollower");
    const view = $("followerView");
    if (tab) tab.remove();
    if (view) view.remove();
    if (typeof window.setMode === "function") {
      try { window.setMode("art"); } catch (e) {}
    }
  }

  async function armLive() {
    const word = ($("followerLiveConfirm") && $("followerLiveConfirm").value) || "";
    const note = $("followerArmNote");
    try {
      const r = await fetch("/api/follower/live", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: word }),
      });
      const d = await r.json().catch(function () { return {}; });
      if ($("followerLiveConfirm")) $("followerLiveConfirm").value = "";
      if (d && d.ok) {
        paintLive(d);
        if (note) note.textContent = "Live arming. First live order also confirms.";
      } else if (note) {
        note.textContent = "Type LIVE to arm.";
      }
    } catch (e) {
      if (note) note.textContent = "Type LIVE to arm.";
    }
  }

  async function liveOff() {
    try {
      const r = await fetch("/api/follower/live-off", { method: "POST", credentials: "same-origin" });
      const d = await r.json().catch(function () { return {}; });
      paintLive(d && d.ok ? d : { live: false });
    } catch (e) {
      paintLive({ live: false });
    }
    if ($("followerLiveConfirm")) $("followerLiveConfirm").value = "";
  }

  function intentBody(live) {
    return {
      asset: ($("followerOrderAsset") && $("followerOrderAsset").value) || "btc",
      side: ($("followerOrderSide") && $("followerOrderSide").value) || "UP",
      stake: Number(($("followerOrderStake") && $("followerOrderStake").value) || 25),
      contracts: Number(($("followerOrderContracts") && $("followerOrderContracts").value) || 1),
      live: !!live,
      confirm_first: ($("followerOrderConfirm") && $("followerOrderConfirm").value) || "",
    };
  }

  async function sendOrder(live) {
    const st = $("followerOrderStatus");
    try {
      const r = await fetch("/api/follower/order", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intentBody(live)),
      });
      const d = await r.json().catch(function () { return {}; });
      if ($("followerOrderConfirm")) $("followerOrderConfirm").value = "";
      if (!st) return;
      if (d && d.accepted) {
        st.textContent = live ? "Intended live held — not routed." : "Intended paper recorded.";
      } else {
        st.textContent = "Refused";
      }
    } catch (e) {
      if (st) st.textContent = "Refused";
    }
  }

  function onHide() {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/follower/live-off", "");
      } else {
        fetch("/api/follower/live-off", { method: "POST", credentials: "same-origin", keepalive: true });
      }
    } catch (e) {}
  }

  function wire() {
    placeTab();
    document.body.classList.add("follower-unlocked");
    const arm = $("followerArmBtn");
    const off = $("followerLiveOffBtn");
    const paper = $("followerPaperBtn");
    const live = $("followerLiveBtn");
    if (arm && !arm.__wired) {
      arm.__wired = true;
      arm.addEventListener("click", armLive);
    }
    if (off && !off.__wired) {
      off.__wired = true;
      off.addEventListener("click", liveOff);
    }
    if (paper && !paper.__wired) {
      paper.__wired = true;
      paper.addEventListener("click", function () { sendOrder(false); });
    }
    if (live && !live.__wired) {
      live.__wired = true;
      live.addEventListener("click", function () { sendOrder(true); });
    }
    ["followerLiveConfirm", "followerOrderConfirm"].forEach(function (id) {
      const el = $(id);
      if (!el || el.__hotkeys) return;
      el.__hotkeys = true;
      el.addEventListener("keydown", function (e) {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }, true);
    });
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("keydown", function (e) {
      if (e.key !== "8") return;
      const t = e.target;
      const tag = (t && t.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (typeof window.setMode === "function") window.setMode("follower");
    });
    document.addEventListener("pointerdown", function () { heartbeat(); }, { passive: true });
  }

  async function tick() {
    const d = await status();
    if (!d || !d.ok) {
      dropSession();
      return;
    }
    paintLive(d);
    try { renderFollower(); } catch (e) {}
    await heartbeat();
  }

  wire();
  tick();
  setInterval(tick, 30000);
})();
