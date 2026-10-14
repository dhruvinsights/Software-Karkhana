# Copyright 2026 Software Karkhana authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Karkhana control plane: FastAPI on Cloud Run.

Serves the JSON API under ``/api``, worker callbacks under ``/internal`` and
the built React app for everything else. Same module name as the Agent
Starter Pack (``app.fast_api_app:app``) so its Makefile and Dockerfile work.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app import db
from app.app_utils.telemetry import setup_telemetry
from app.config import get_settings
from app.routers import platform, projects, reviews, runs


def _setup_logging() -> None:
    """Structured logs to Cloud Logging on Cloud Run, plain logs locally."""
    if os.environ.get("K_SERVICE"):
        try:
            import google.cloud.logging

            google.cloud.logging.Client().setup_logging(log_level=logging.INFO)
            return
        except Exception:  # Fall back to stdout, which Cloud Run also collects.
            logging.exception("Cloud Logging setup failed")
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Startup and shutdown hooks."""
    _setup_logging()
    setup_telemetry()
    yield
    await db.dispose()


def create_app() -> FastAPI:
    """Builds the application."""
    settings = get_settings()
    app = FastAPI(
        title="Software Karkhana",
        description="One record for every team, from idea to merged code.",
        version=os.environ.get("AGENT_VERSION", "0.1.0"),
        lifespan=lifespan,
    )
    if settings.allow_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.allow_origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    for r in (projects.router, runs.router, reviews.router, platform.router):
        app.include_router(r)

    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> dict[str, str]:
        async with db.sessionmaker()() as s:
            await s.execute(text("SELECT 1"))
        return {"status": "ok", "version": os.environ.get("COMMIT_SHA", "dev")}

    @app.get("/api/config", include_in_schema=False)
    async def public_config() -> dict:
        """Non-secret settings the browser needs (Firebase web config comes from env)."""
        return {
            "authMode": settings.auth_mode,
            "firebase": {
                "apiKey": os.environ.get("FIREBASE_WEB_API_KEY", ""),
                "authDomain": os.environ.get("FIREBASE_AUTH_DOMAIN", ""),
                "projectId": settings.firebase_project_id
                or settings.google_cloud_project,
            },
            "githubRepo": settings.github_repo,
            "runner": settings.runner_backend,
            "demoFallback": settings.demo_fallback,
        }

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception) -> JSONResponse:
        logging.getLogger("karkhana").exception("Unhandled error: %s", exc)
        return JSONResponse(
            {"detail": "Internal error. It has been logged."}, status_code=500
        )

    static = Path(settings.static_dir)
    if static.is_dir():
        app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str) -> FileResponse:
            candidate = (static / path).resolve()
            if path and candidate.is_file() and static.resolve() in candidate.parents:  # noqa: ASYNC240 - stat on a local file
                return FileResponse(candidate)
            return FileResponse(static / "index.html")

    return app


app = create_app()
