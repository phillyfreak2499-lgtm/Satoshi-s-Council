import { useRouterState } from "@tanstack/react-router";
import { CouncilNavigation, type HeaderAction } from "./CouncilNavigation";
import { DeskSoundControl } from "./DeskSoundControl";
import { ResearchQuietNotice } from "./ResearchQuietNotice";
import { deskSoundViewActive } from "@/lib/desk/desk-sound-events";
import "./DeskSoundControl.css";

/** One navigation map for every room, including query-based Gallery and Settings. */
export function GlobalHeader({ action, tour, searchOverride }: { action?: HeaderAction; tour?: string; searchOverride?: string }) {
  const location = useRouterState({ select: state => state.location });
  const search = searchOverride ?? location.searchStr;
  return <>
    <ResearchQuietNotice />
    <CouncilNavigation pathname={location.pathname} search={search} action={action} tour={tour}
      controls={(location.pathname === "/desk" || (location.pathname === "/" && /[?&](tab|view|seat)=/.test(search))) ? <DeskSoundControl active={deskSoundViewActive(location.pathname, search)} /> : undefined} />
  </>;
}
