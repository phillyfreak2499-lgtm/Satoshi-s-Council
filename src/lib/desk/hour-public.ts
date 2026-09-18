import { createServerFn } from "@tanstack/react-start";
import type { HourBrief } from "./hour";

/** Read-only hourly brief for the public /hour page. Authority: none. */
export const publicHourBrief = createServerFn({ method: "GET" }).handler(async (): Promise<HourBrief> => {
  const { hourBrief } = await import("./hour.server");
  return hourBrief();
});
