import { createFileRoute } from "@tanstack/react-router";
import { ChamberRoute } from "@/components/chamber/ChamberRoute";

/**
 * /chamber — the observation interface. Client-only: with `ssr: false` nothing here
 * runs on the server, so no WebGL is ever attempted during SSR and no 3D code touches
 * the Floor's bundle. See docs/CHAMBER_VISUAL_DOCTRINE.md.
 */
export const Route = createFileRoute("/chamber")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "THE CHAMBER · Satoshi's Council" },
      {
        name: "description",
        content:
          "An observation interface over the paper-only research desk. Presentation fixtures, no live authority. Paper only. Not advice. Not Kalshi orders.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ChamberRoute,
});
