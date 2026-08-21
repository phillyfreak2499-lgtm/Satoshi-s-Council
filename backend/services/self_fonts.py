"""Self-hosted latin woff2. Decoded onto static/fonts at import."""
from __future__ import annotations

import base64
from pathlib import Path

FONT_FILES = (
    "orbitron-700.woff2",
    "rajdhani-500.woff2",
    "rajdhani-600.woff2",
    "rajdhani-700.woff2",
    "share-tech-mono-400.woff2",
)

MARKER = "/* council-self-fonts */"
FONT_HINT = "orbitron-700.woff2"

FONTS_CSS = """/* self-hosted latin — no Google hop */
@font-face {
  font-family: 'Orbitron';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/orbitron-700.woff2') format('woff2');
}
@font-face {
  font-family: 'Rajdhani';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/rajdhani-500.woff2') format('woff2');
}
@font-face {
  font-family: 'Rajdhani';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('/fonts/rajdhani-600.woff2') format('woff2');
}
@font-face {
  font-family: 'Rajdhani';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/rajdhani-700.woff2') format('woff2');
}
@font-face {
  font-family: 'Share Tech Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/share-tech-mono-400.woff2') format('woff2');
}
"""


def ensure_self_fonts(static_dir=None) -> None:
    root = Path(static_dir) if static_dir else (
        Path(__file__).resolve().parents[2] / "frontend" / "static"
    )
    try:
        dest = root / "fonts"
        dest.mkdir(parents=True, exist_ok=True)
    except OSError:
        return
    for name in FONT_FILES:
        path = dest / name
        if path.is_file() and path.stat().st_size > 1000:
            continue
        blob = dest / (name + ".b64")
        if not blob.is_file():
            continue
        try:
            path.write_bytes(base64.b64decode(blob.read_text().strip()))
        except (OSError, ValueError):
            pass
    css_path = root / "fonts.css"
    try:
        if not css_path.is_file() or FONT_HINT not in css_path.read_text(encoding="utf-8"):
            css_path.write_text(FONTS_CSS, encoding="utf-8")
    except OSError:
        pass
    _stitch(root)


def _stitch(root: Path) -> None:
    style = root / "style.css"
    if not style.is_file():
        return
    try:
        text = style.read_text(encoding="utf-8")
    except OSError:
        return
    if FONT_HINT in text:
        return
    chunk = MARKER + "\n" + FONTS_CSS + "\n"
    if text.startswith(MARKER):
        text = text[len(MARKER):].lstrip("\n")
    text = chunk + text
    try:
        style.write_text(text, encoding="utf-8")
    except OSError:
        pass
