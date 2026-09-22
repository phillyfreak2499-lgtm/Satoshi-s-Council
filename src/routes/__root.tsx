import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { GaPageViews } from "@/components/analytics/GaPageViews";
import appCss from "../styles.css?url";

const APP_NAME = "Satoshi's Council";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "A paper-only Bitcoin 15-minute research desk. The Council has 21 seats: 15 currently voting, 3 retired from votes, and 3 non-voting pit crew; SATOSHI chairs. Nothing here places a live trade. Not financial advice.",
      },
      { name: "theme-color", content: "#0b0c10" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/icon-32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/icon-16.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "alternate", type: "application/atom+xml", title: "Satoshi's Council — board updates", href: "/feed.xml" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        {/* Google tag (gtag.js). Page views are emitted explicitly by GaPageViews. */}
        <script
          async
          data-sc-ga4="loader"
          src="https://www.googletagmanager.com/gtag/js?id=G-JMQGD1WTVT"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());

gtag('config', 'G-JMQGD1WTVT', { send_page_view: false });
window.__scGa4Configured = true;`,
          }}
        />
        <HeadContent />
      </head>
      <body className="bg-bg text-fg">
        <GaPageViews />
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
