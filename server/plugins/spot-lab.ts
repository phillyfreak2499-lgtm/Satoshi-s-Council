import { definePlugin } from "nitro";
/** Independent, disabled by default; application boot never waits for collection. */
export default definePlugin(app => {
  if (process.env.SPOT_LAB !== "1") return;
  let closed = false;
  let stop: (() => void) | undefined;
  app.hooks.hook("close", () => { closed = true; stop?.(); });
  void import("../../src/lib/spot-lab/spot-lab.server").then(module => {
    if (!closed) stop = module.startSpotLab();
  }).catch(() => console.error("[spot-lab] optional paper process unavailable"));
});
