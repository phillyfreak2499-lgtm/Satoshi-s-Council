"""Serve the late desk patches at both /static/* and the site-root URLs
seat.js used to request.

Old service-worker caches still ask for /focus-table.js, /watch-loop.js,
/layout-cleanup.css, and /watch-loop.css. Those 404'd because FastAPI only
mounted them under /static. Root aliases keep returning visitors unstuck
without waiting for a cache-version bump.

Also softens intermittent SQLite-lock 500s on workspace ensure / journal
cards so the desk stays JSON instead of a blank error page.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, ORJSONResponse
from loguru import logger

_installed = False


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


def _is_busy(exc: BaseException) -> bool:
    msg = str(exc).lower()
    name = type(exc).__name__.lower()
    return (
        "database is locked" in msg
        or "database is busy" in msg
        or ("sqlite" in name and "lock" in msg)
        or "operationalerror" in name
        or "locked" in msg
    )


def _patch_store() -> None:
    """Retry the two hot public/desk reads when SQLite is under contention."""
    from backend.storage.db import PerformanceStore

    def _wrap_retry(orig, empty=None, times: int = 4):
        async def wrapped(self, *args, **kwargs):
            last: BaseException | None = None
            for i in range(times):
                try:
                    return await orig(self, *args, **kwargs)
                except Exception as exc:  # noqa: BLE001 — store miss must not 500
                    last = exc
                    if i + 1 < times and _is_busy(exc):
                        await asyncio.sleep(0.04 * (i + 1))
                        continue
                    if empty is not None and _is_busy(exc):
                        logger.warning(f"{orig.__name__} busy after retry — empty payload")
                        return empty
                    raise
            if empty is not None:
                return empty
            raise last  # type: ignore[misc]

        return wrapped

    if getattr(PerformanceStore.get_or_create_workspace_account, "_desk_patched", False):
        return
    PerformanceStore.get_or_create_workspace_account = _wrap_retry(
        PerformanceStore.get_or_create_workspace_account
    )
    PerformanceStore.get_or_create_workspace_account._desk_patched = True
    PerformanceStore.workspace_snapshot = _wrap_retry(
        PerformanceStore.workspace_snapshot
    )
    PerformanceStore.journal_rows = _wrap_retry(
        PerformanceStore.journal_rows, empty=[]
    )


def _install_softener(app: FastAPI) -> None:
    """Turn leftover 500s on the two hot paths into JSON 503 / empty cards."""

    @app.middleware("http")
    async def soften_hot_path_500s(request: Request, call_next):
        try:
            response = await call_next(request)
        except Exception:
            path = request.url.path
            if path == "/api/public/workspace/ensure":
                logger.exception("workspace_ensure exploded")
                return ORJSONResponse(
                    {"ok": False, "error": "workspace busy", "retry": True},
                    status_code=503,
                )
            if path == "/api/public/workspace":
                logger.exception("workspace_snapshot exploded")
                return ORJSONResponse(
                    {"ok": False, "error": "workspace busy", "retry": True},
                    status_code=503,
                )
            if path == "/api/journal/cards":
                logger.exception("journal_cards exploded")
                return ORJSONResponse({"ok": True, "cards": [], "degraded": True})
            raise
        if response.status_code != 500:
            return response
        path = request.url.path
        if path == "/api/public/workspace/ensure":
            return ORJSONResponse(
                {"ok": False, "error": "workspace busy", "retry": True},
                status_code=503,
            )
        if path == "/api/public/workspace":
            return ORJSONResponse(
                {"ok": False, "error": "workspace busy", "retry": True},
                status_code=503,
            )
        if path == "/api/journal/cards":
            return ORJSONResponse({"ok": True, "cards": [], "degraded": True})
        return response


def install() -> None:
    """Idempotent hook. Safe to call from the first request after boot."""
    global _installed
    if _installed:
        return
    try:
        from backend.main import ASSET_CACHE, STATIC_DIR, app
    except Exception:
        logger.debug("desk_patches.install skipped — app not ready")
        return
    try:
        register_desk_patches(app, STATIC_DIR, ASSET_CACHE)
    except Exception:
        logger.exception("desk_patches root aliases failed")
    try:
        _install_softener(app)
    except Exception:
        logger.exception("desk_patches softener failed")
    try:
        _patch_store()
    except Exception:
        logger.exception("desk_patches store wrap failed")
    _installed = True
