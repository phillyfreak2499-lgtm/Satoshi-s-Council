"""Origin headers Cloudflare can pass through.

HSTS, nosniff, referrer, frame deny, and a basic CSP. Inline scripts in the
assembler and desk HTML need 'unsafe-inline'. Google Fonts are the only
third-party origin.
"""
from __future__ import annotations

CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "img-src 'self' data: blob:; "
    "media-src 'self' blob:; "
    "connect-src 'self'; "
    "worker-src 'self'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)

HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": CSP,
}


def apply_security_headers(response) -> None:
    headers = getattr(response, "headers", None)
    if headers is None:
        return
    for key, value in HEADERS.items():
        headers.setdefault(key, value)
