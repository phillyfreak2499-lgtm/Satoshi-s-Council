"""Origin headers Cloudflare can pass through.

HSTS, nosniff, referrer, frame deny, and a basic CSP. Inline scripts in the
assembler and desk HTML need 'unsafe-inline'. Fonts are self-hosted (data-URI
in /style.css after stitch). Google Fonts stay allowed for older packed desks.
"""
from __future__ import annotations

CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' data: https://fonts.gstatic.com; "
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
