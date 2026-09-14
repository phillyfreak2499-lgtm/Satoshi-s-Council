/**
 * Baseline response hardening for the public desk.
 *
 * The app intentionally keeps one inline analytics/bootstrap script and loads its
 * two typefaces from Google, so the CSP names those sources explicitly. Market
 * data, paper calls and browser preferences remain same-origin.
 */
interface SecurityHeadersEvent {
  url: URL;
  req: { headers: Headers };
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://www.google-analytics.com https://www.googletagmanager.com",
  "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

function isHttps(event: SecurityHeadersEvent): boolean {
  const forwarded = event.req.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  return forwarded ? forwarded === "https" : event.url.protocol === "https:";
}

function harden(response: Response, secure: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
  headers.set("x-frame-options", "DENY");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  if (secure) {
    headers.set("strict-transport-security", "max-age=31536000");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default async function securityHeadersMiddleware(
  event: SecurityHeadersEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const result = await next();
  return result instanceof Response ? harden(result, isHttps(event)) : result;
}
