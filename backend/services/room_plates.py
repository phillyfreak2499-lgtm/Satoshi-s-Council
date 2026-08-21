"""Missing chair room stills. Written onto the static dir at import."""
from __future__ import annotations

import base64
from pathlib import Path

# Tiny atmospheric WebP plates for chairs that had no still.
WEBP_B64 = {
    "vitalik-city": "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",
}

MARKER = "/* council-self-fonts */"


def svg_for(stem: str):
    return None


def ensure_room_stills(static_dir=None) -> None:
    root = Path(static_dir) if static_dir else (
        Path(__file__).resolve().parents[2] / "frontend" / "static"
    )
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        return
    for name, blob in WEBP_B64.items():
        path = root / f"{name}.webp"
        if path.is_file() and path.stat().st_size > 200:
            continue
        try:
            path.write_bytes(base64.b64decode(blob))
        except OSError:
            pass
    _stitch_fonts(root)


def _stitch_fonts(root: Path) -> None:
    style = root / "style.css"
    fonts = root / "fonts.css"
    rooms = root / "rooms.css"
    if not style.is_file():
        return
    try:
        text = style.read_text(encoding="utf-8")
    except OSError:
        return
    if MARKER in text:
        return
    chunks = [MARKER]
    if fonts.is_file():
        chunks.append(fonts.read_text(encoding="utf-8"))
    if rooms.is_file():
        chunks.append(rooms.read_text(encoding="utf-8"))
    try:
        style.write_text("\n".join(chunks) + "\n" + text, encoding="utf-8")
    except OSError:
        pass
