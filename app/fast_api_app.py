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

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app import db
from app.app_utils.telemetry import setup_telemetry
from app.config import get_settings
from app.knowledge_graph import client as kg_client
from app.knowledge_graph import projector as kg_projector
from app.routers import (
    agent_devices,
    auth,
    chat,
    context,
    delivery,
    dev_qa,
    gemini,
    github_oauth,
    home,
    idea_approvals,
    idea_groups,
    idea_lab,
    invites,
    issues,
    operations,
    plan,
    platform,
    products,
    project_docs,
    project_launch,
    projects,
    qa_board,
    rag,
    reviews,
    run_control,
    run_publish,
    runs,
    security,
    stations,
    stitch,
    workspace,
    workspaces,
)
from app.services import chat_retention, osv_scan, realtime


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
    await realtime.manager.start_broker()
    purge = asyncio.create_task(chat_retention.run_forever())
    kg = None
    if kg_client.enabled():
        kg = asyncio.create_task(kg_projector.run_forever())
    scans = asyncio.create_task(osv_scan.run_forever())
    yield
    purge.cancel()
    scans.cancel()
    if kg:
        kg.cancel()
        await kg_client.close()
    await realtime.manager.stop_broker()
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
    for r in (
        agent_devices.router,
        auth.router,
        chat.router,
        delivery.router,
        dev_qa.router,
        gemini.router,
        github_oauth.router,
        home.router,
        products.router,
        idea_approvals.router,
        idea_groups.router,
        idea_lab.router,
        invites.router,
        issues.router,
        operations.router,
        plan.router,
        project_docs.router,
        project_launch.router,
        projects.router,
        qa_board.router,
        rag.router,
        runs.router,
        run_control.router,
        run_publish.router,
        reviews.router,
        platform.router,
        workspace.router,
        workspaces.router,
        context.router,
        security.router,
        stations.router,
        stitch.router,
    ):
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
            "llmProvider": settings.llm_provider,
            "embedProvider": settings.embed_provider,
            "reviewEngine": settings.review_engine,
        }

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

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
            # An unknown API route is a 404, never the app shell with a 200.
            if path.split("/", 1)[0] in ("api", "internal"):
                raise HTTPException(status_code=404, detail="Not found")
            candidate = (static / path).resolve()
            if path and candidate.is_file() and static.resolve() in candidate.parents:  # noqa: ASYNC240 - stat on a local file
                return FileResponse(candidate)
            return FileResponse(static / "index.html")

    return app


app = create_app()
