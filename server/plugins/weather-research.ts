import { definePlugin } from "nitro";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

/** Independent private process. Default off. No Council/Chair/paper imports. */
export default definePlugin((app) => {
  if (process.env.RENDER !== "true" || process.env.WEATHER_RESEARCH_ENABLED !== "true") return;
  let child: ChildProcess | null = null;
  let closing = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const start = () => {
    if (closing) return;
    child = spawn(
      process.execPath,
      ["--max-old-space-size=96", join(process.cwd(), "research/weather/runner.mjs"), "--daemon"],
      {
        stdio: ["ignore", "inherit", "inherit"],
        env: {
          DATABASE_URL: process.env.DATABASE_URL,
          WEATHER_RESEARCH_ENABLED: "true",
          PATH: process.env.PATH,
          NODE_ENV: "production",
        },
      },
    );
    child.on("error", () => console.error("private weather process could not start"));
    child.on("exit", () => {
      child = null;
      if (!closing) retry = setTimeout(start, 300000);
    });
  };
  app.hooks.hook("close", () => {
    closing = true;
    if (retry) clearTimeout(retry);
    child?.kill("SIGTERM");
  });
  start();
});
