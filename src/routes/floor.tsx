import { createFileRoute, redirect } from "@tanstack/react-router";

/** An old address for the live floor. It opens /desk and starts the tour. */
export const Route = createFileRoute("/floor")({
  beforeLoad: () => {
    throw redirect({ href: "/desk?tour=1", statusCode: 302 });
  },
});
