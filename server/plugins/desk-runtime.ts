import { definePlugin } from "nitro";
import { ensureDeskRuntime } from "../../src/lib/desk/runtime-bootstrap.server";

/**
 * Render's production Node process owns the long-running Council timers.
 * Boot them when the process starts instead of waiting for the first health
 * request. Other deployment targets retain the request-triggered fallback.
 */
export default definePlugin(() => {
  if (process.env.RENDER !== "true" || process.env.RENDER_SERVICE_TYPE !== "web") return;
  ensureDeskRuntime();
});
