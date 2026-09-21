import { createServerFn } from "@tanstack/react-start";
import type { HourResearchBrief } from "./hour-research-brief";

/** Read-only hourly research brief for the public /hour page. Authority: none. */
export const publicHourResearch = createServerFn({ method: "GET" }).handler(async (): Promise<HourResearchBrief> => {
  const { hourResearchBrief } = await import("./hour-research-brief.server");
  return hourResearchBrief();
});
