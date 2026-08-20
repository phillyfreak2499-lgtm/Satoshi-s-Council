/* Live wire off the UI thread. Parse JSON here. Main thread only paints. */
let timer = null;
let url = "/api/state";

async function tick() {
  try {
    const r = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) throw new Error(String(r.status));
    const payload = await r.json();
    self.postMessage({ type: "state", payload: payload });
  } catch (err) {
    self.postMessage({ type: "miss" });
  }
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

self.onmessage = function (ev) {
  const m = ev.data || {};
  if (m.type === "stop") {
    stop();
    return;
  }
  if (m.type === "tick") {
    tick();
    return;
  }
  if (m.type === "start") {
    if (m.url) url = m.url;
    stop();
    tick();
    timer = setInterval(tick, Math.max(2000, Number(m.ms) || 7000));
  }
};
