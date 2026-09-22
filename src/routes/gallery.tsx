import { createFileRoute, redirect } from "@tanstack/react-router";

/** Public Gallery URL. The live art still lives on the desk atelier tab. */
export const Route = createFileRoute("/gallery")({
  beforeLoad: () => {
    throw redirect({ href: "/?tab=atelier", statusCode: 302 });
  },
});
