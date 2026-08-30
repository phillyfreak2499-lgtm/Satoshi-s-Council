"""Serve the late desk patches at both /static/* and the site-root URLs
seat.js used to request.

Old service-worker caches still ask for /focus-table.js, /watch-loop.js,
/layout-cleanup.css, and /watch-loop.css. Those 404'd because FastAPI only
mounted them under /static. Root aliases keep returning visitors unstuck
without waiting for a cache-version bump.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.responses import FileResponse


def _file_or_404(path: Path, media_type: str, headers: dict | None = None) -> Response:
    if not path.is_file():
        return Response(status_code=404)
    return FileResponse(path, media_type=media_type, headers=headers or {})


def register_desk_patches(app: FastAPI, static_dir: Path, asset_cache: dict) -> None:
    cache = {"Cache-Control": asset_cache.get("Cache-Control", "public, max-age=86400")}

    @app.get("/layout-cleanup.css")
    async def layout_cleanup_css() -> Response:
        return _file_or_404(static_dir / "layout-cleanup.css", "text/css", cache)

    @app.get("/focus-table.js")
    async def focus_table_js() -> Response:
        return _file_or_404(static_dir / "focus-table.js", "application/javascript", cache)

    @app.get("/watch-loop.js")
    async def watch_loop_js() -> Response:
        return _file_or_404(static_dir / "watch-loop.js", "application/javascript", cache)

    @app.get("/watch-loop.css")
    async def watch_loop_css() -> Response:
        return _file_or_404(static_dir / "watch-loop.css", "text/css", cache)
