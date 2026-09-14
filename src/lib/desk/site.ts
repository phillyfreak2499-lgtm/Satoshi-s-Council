/** The canonical origin for absolute links in share cards. Client-safe. */
export const SITE_ORIGIN = "https://satoshiscouncil.com";

export function ogWindowImage(ticker: string): string {
  return `${SITE_ORIGIN}/og/window?ticker=${encodeURIComponent(ticker)}`;
}

export function ogSeatImage(id: string): string {
  return `${SITE_ORIGIN}/og/seat?id=${encodeURIComponent(id)}`;
}


/** Route-owned metadata: raw strings are escaped once by the renderer. */
export function pageHead(path: string, title: string, description: string, image = SITE_ORIGIN + "/og/page?page=" + encodeURIComponent(path)) {
  const url = SITE_ORIGIN + path;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Satoshi's Council" },
      { property: "og:image", content: image },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: image },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
