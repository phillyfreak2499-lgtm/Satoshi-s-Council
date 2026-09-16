import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { selectComponent } from "./extract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const uiFiles = ["src/components/desk/SatoshiTab.tsx", "src/components/desk/CouncilFloorRoom.tsx",
  "src/components/atelier/streamer.tsx", "src/components/atelier/streamer.css", "src/styles.css"];
const baseCommit = "12c9d12f0787825fc4be5b27e4144232df69eed3";
let building = false;

export default defineConfig({
  root: resolve(root, "preview"),
  publicDir: false,
  envDir: false,
  define: { __PREVIEW_COMMIT__: JSON.stringify(baseCommit) },
  resolve: { alias: [
    { find: "@/lib/desk/beacon", replacement: resolve(root, "preview/noop.ts") },
    { find: "@", replacement: resolve(root, "src") },
  ] },
  plugins: [
    {
      name: "isolated-existing-ui",
      enforce: "pre",
      configResolved(config) { building = config.command === "build"; },
      transform(code, id) {
        if (id.endsWith("/src/components/desk/SatoshiTab.tsx")) return selectComponent(code, id, "ChairBoard");
        if (id.endsWith("/src/components/desk/FloorClarity.tsx")) return selectComponent(code, id, "CallPrices");
      },
      buildStart() {
        if (!building) return;
        for (const path of ["floor/council-chamber-v1.webp", "atelier/streamer-concept.png", "seal-figure.png"]) {
          this.emitFile({ type: "asset", fileName: path, source: readFileSync(resolve(root, "public", path)) });
        }
        this.emitFile({ type: "asset", fileName: "robots.txt", source: "User-agent: *\nDisallow: /\n" });
        this.emitFile({ type: "asset", fileName: "preview-manifest.json", source: JSON.stringify({
          purpose: "UI QA only; synthetic data; no backend or production credentials",
          baseCommit,
          files: Object.fromEntries(uiFiles.map(path => [path, createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex")])),
        }, null, 2) });
      },
      generateBundle(_options, bundle) {
        for (const item of Object.values(bundle)) {
          if (item.type !== "chunk") continue;
          for (const module of Object.keys(item.modules)) {
            if (/\/(?:server|auth)\/|\.server\.[cm]?[jt]sx?$|\/desk\/engine\.ts$|\/lib\/db\.ts$/.test(module)) {
              this.error(`Server or auth code is forbidden in the visual preview: ${module}`);
            }
          }
        }
      },
    },
    react(),
    tailwindcss(),
  ],
  build: { outDir: resolve(root, "preview-dist"), emptyOutDir: true, sourcemap: false },
});
