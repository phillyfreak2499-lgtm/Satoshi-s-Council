/** Who gets a settle push. Pure, so it can be tested without a push service. */
export function settleWanted(sub: { token: string | null }, chairCalled: boolean, humans: Map<string, number>): boolean {
  if (chairCalled) return true;
  return Boolean(sub.token && humans.has(sub.token));
}
