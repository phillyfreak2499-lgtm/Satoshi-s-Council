
// api.js – simple poller for Council state
const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://127.0.0.1:8000"
  : ""; // same origin if served together

async function fetchState() {
  try {
    const r = await fetch(`${API_BASE}/api/state`);
    if (!r.ok) throw new Error(r.statusText);
    return await r.json();
  } catch (e) {
    console.warn("State fetch failed", e);
    return null;
  }
}

window.CouncilAPI = { fetchState, API_BASE };
