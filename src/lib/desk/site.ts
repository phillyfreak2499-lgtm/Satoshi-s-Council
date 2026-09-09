/** The canonical origin for absolute links in share cards. Client-safe. */
export const SITE_ORIGIN = "https://satoshiscouncil.com";

export function ogWindowImage(ticker: string): string {
  return `${SITE_ORIGIN}/og/window?ticker=${encodeURIComponent(ticker)}`;
}

export function ogSeatImage(id: string): string {
  return `${SITE_ORIGIN}/og/seat?id=${encodeURIComponent(id)}`;
}
