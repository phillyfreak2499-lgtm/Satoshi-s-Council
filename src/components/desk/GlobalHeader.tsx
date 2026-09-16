import { useRouterState } from "@tanstack/react-router";
import { CouncilNavigation, type HeaderAction } from "./CouncilNavigation";

/** One navigation map for every room, including query-based Gallery and Settings. */
export function GlobalHeader({ action, tour, searchOverride }: { action?: HeaderAction; tour?: string; searchOverride?: string }) {
  const location = useRouterState({ select: state => state.location });
  return <CouncilNavigation pathname={location.pathname} search={searchOverride ?? location.searchStr} action={action} tour={tour} />;
}
