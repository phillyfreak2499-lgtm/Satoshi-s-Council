import { timingSafeEqual } from "node:crypto";

/** Constant-time check against DESK_ADMIN_KEY. Unset env → nothing passes. */
export function adminKeyOk(given: unknown): boolean {
  const want = process.env.DESK_ADMIN_KEY;
  if (!want || typeof given !== "string" || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function adminConfigured(): boolean {
  return Boolean(process.env.DESK_ADMIN_KEY);
}
