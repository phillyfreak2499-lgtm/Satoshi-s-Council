import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { gtagPageView } from "@/lib/desk/ga";

/**
 * GA4 page-view bridge for TanStack Router.
 * Initial document + subsequent SPA route/search changes each emit one page_view.
 */
export function GaPageViews() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const routeKey = `${pathname}${search}`;

  useEffect(() => {
    gtagPageView(routeKey);
  }, [routeKey]);

  return null;
}
