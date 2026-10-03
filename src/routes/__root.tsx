import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { GaPageViews } from "@/components/analytics/GaPageViews";
import { createIsomorphicFn } from "@tanstack/react-start";
import { GA_BOOTSTRAP_SCRIPT, suppressGaForAgent } from "@/lib/desk/ga";
import appCss from "../styles.css?url";

const APP_NAME = "Satoshi's Council";

const analyticsBlocked = createIsomorphicFn()
  .server(async () => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    return suppressGaForAgent(getRequestHeader("user-agent"));
  })
  .client(() => navigator.webdriver === true || suppressGaForAgent(navigator.userAgent));

export const Route = createRootRoute({
  loader: async () => ({ analyticsBlocked: await analyticsBlocked() }),
  headers: () => ({ Vary: "User-Agent" }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "A paper-only Bitcoin 15-minute research desk. 21 research roles, a 15-role voting roster, and fewer eligible LIVE sources. Quarantined research seats do not vote; SATOSHI chairs. Nothing here places a live trade. Not financial advice.",
      },
      { name: "theme-color", content: "#0b0c10" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/icon-32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/icon-16.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      {
        rel: "alternate",
        type: "application/atom+xml",
        title: "Satoshi's Council — board updates",
        href: "/feed.xml",
      },
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
  component: RootDocument,
});

function RootDocument() {
  const { analyticsBlocked } = Route.useLoaderData();
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        {/* Known bots receive no Google loader or config. Hydration cannot repair it. */}
        <script
          dangerouslySetInnerHTML={{
            __html: analyticsBlocked ? "window.__scGa4Blocked = true;" : GA_BOOTSTRAP_SCRIPT,
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
  );
}
