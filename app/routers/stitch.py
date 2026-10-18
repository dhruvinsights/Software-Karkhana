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

"""Google Stitch endpoints for the designer dashboard.

Every route except ``GET .../stitch`` requires the caller to hold the project's
design station (see :mod:`app.services.stitch_design`). ``GET .../stitch``
answers everyone who can see the project, but returns screens and jobs only to
designers; others get ``canUse: false`` so the UI simply hides the studio.
"""

from __future__ import annotations

import datetime as dt
import re
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app import access, db, ledger
from app.auth import CurrentUser
from app.config import get_settings
from app.models import Project, StitchJob, StitchProject, StitchScreen
from app.services import stitch_design

router = APIRouter(tags=["stitch"])
Session = Annotated[AsyncSession, Depends(db.get_session)]

Device = Literal["MOBILE", "DESKTOP", "TABLET", "AGNOSTIC"]
Model = Literal["GEMINI_3_FLASH", "GEMINI_3_1_PRO"]


class GenerateIn(BaseModel):
    """A brief for a new screen."""

    prompt: str = Field(min_length=3, max_length=stitch_design.MAX_PROMPT_CHARS)
    device_type: Device = "DESKTOP"
    model_id: Model | None = None
    story_keys: list[str] = Field(
        default_factory=list, max_length=stitch_design.MAX_STORIES
    )


class EditIn(BaseModel):
    """A change to one screen."""

    prompt: str = Field(min_length=3, max_length=stitch_design.MAX_PROMPT_CHARS)
    model_id: Model | None = None


class VariantsIn(BaseModel):
    """Alternatives of one screen."""

    prompt: str = Field(min_length=3, max_length=stitch_design.MAX_PROMPT_CHARS)
    count: int = Field(default=3, ge=1, le=5)
    creative_range: Literal["REFINE", "EXPLORE", "REIMAGINE"] = "EXPLORE"
    aspects: list[
        Literal["LAYOUT", "COLOR_SCHEME", "IMAGES", "TEXT_FONT", "TEXT_CONTENT"]
    ] = Field(default_factory=list, max_length=5)
    model_id: Model | None = None


class ScreenPatch(BaseModel):
    """Pin a screen for the developer handoff."""

    pinned: bool


async def _designer_project(
    session: AsyncSession,
    user: Any,
    project_id: uuid.UUID,
    *,
    need_service: bool = True,
) -> Project:
    project = await access.get_visible_project(session, user, project_id)
    await stitch_design.require_designer(
        session, user, project, need_service=need_service
    )
    return project


async def _screen(
    session: AsyncSession,
    project: Project,
    screen_id: uuid.UUID,
    *,
    with_: tuple[str, ...] = (),
) -> StitchScreen:
    q = select(StitchScreen).where(
        StitchScreen.id == screen_id, StitchScreen.project_id == project.id
    )
    for col in with_:
        q = q.options(undefer(getattr(StitchScreen, col)))
    row = await session.scalar(q)
    if row is None or row.archived_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Screen not found.")
    return row


async def _active_job(session: AsyncSession, project_id: uuid.UUID) -> StitchJob | None:
    return await session.scalar(
        select(StitchJob)
        .where(StitchJob.project_id == project_id)
        .order_by(StitchJob.created_at.desc())
        .limit(1)
    )


@router.get("/api/projects/{project_id}/stitch")
async def stitch_home(
    project_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Whether the studio shows for this user, and (for designers) its screens and latest job."""
    project = await access.get_visible_project(session, user, project_id)
    settings = get_settings()
    ok, why = await stitch_design.can_use(session, user, project)
    out: dict[str, Any] = {
        "enabled": settings.stitch_enabled,
        "configured": settings.stitch_configured,
        "isDesigner": ok,
        "canUse": ok and settings.stitch_configured,
        "reason": why
        if not ok
        else (
            ""
            if settings.stitch_configured
            else "Google Stitch is not enabled on this server."
        ),
    }
    if not ok:
        return out
    await stitch_design.expire_stale(session, project.id)
    screens = (
        await session.scalars(
            select(StitchScreen)
            .where(
                StitchScreen.project_id == project.id,
                StitchScreen.archived_at.is_(None),
            )
            .order_by(StitchScreen.created_at.desc())
        )
    ).all()
    linked = await session.get(StitchProject, project.id)
    job = await _active_job(session, project.id)
    out.update(
        {
            "quota": await stitch_design.quota(session, project.workspace_id),
            "defaultModel": settings.stitch_default_model,
            "stitchProjectId": linked.stitch_project_id if linked else None,
            "job": stitch_design.job_out(job) if job else None,
            "screens": [stitch_design.screen_out(s) for s in screens],
        }
    )
    return out


async def _launch(
    session: AsyncSession,
    background: BackgroundTasks,
    user: Any,
    project: Project,
    *,
    kind: str,
    prompt: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    job = await stitch_design.start_job(
        session, user, project, kind=kind, prompt=prompt, params=params
    )
    background.add_task(stitch_design.run_job, job.id)
    return stitch_design.job_out(job)


@router.post(
    "/api/projects/{project_id}/stitch/generate", status_code=status.HTTP_202_ACCEPTED
)
async def generate(
    project_id: uuid.UUID,
    body: GenerateIn,
    session: Session,
    user: CurrentUser,
    background: BackgroundTasks,
) -> dict[str, Any]:
    """Generates a new screen from a brief (and the stories it cites)."""
    project = await _designer_project(session, user, project_id)
    prompt = await stitch_design.build_prompt(
        session, project, body.prompt, body.story_keys
    )
    return await _launch(
        session,
        background,
        user,
        project,
        kind="generate",
        prompt=prompt,
        params={
            "device_type": body.device_type,
            "model_id": body.model_id or get_settings().stitch_default_model,
            "story_keys": body.story_keys,
        },
    )


@router.post(
    "/api/projects/{project_id}/stitch/screens/{screen_id}/edit",
    status_code=status.HTTP_202_ACCEPTED,
)
async def edit(
    project_id: uuid.UUID,
    screen_id: uuid.UUID,
    body: EditIn,
    session: Session,
    user: CurrentUser,
    background: BackgroundTasks,
) -> dict[str, Any]:
    """Changes one screen with a prompt."""
    project = await _designer_project(session, user, project_id)
    row = await _screen(session, project, screen_id)
    return await _launch(
        session,
        background,
        user,
        project,
        kind="edit",
        prompt=body.prompt.strip(),
        params={
            "screen_id": str(row.id),
            "device_type": row.device_type,
            "model_id": body.model_id or get_settings().stitch_default_model,
        },
    )


@router.post(
    "/api/projects/{project_id}/stitch/screens/{screen_id}/variants",
    status_code=status.HTTP_202_ACCEPTED,
)
async def variants(
    project_id: uuid.UUID,
    screen_id: uuid.UUID,
    body: VariantsIn,
    session: Session,
    user: CurrentUser,
    background: BackgroundTasks,
) -> dict[str, Any]:
    """Generates 1 to 5 alternatives of one screen."""
    project = await _designer_project(session, user, project_id)
    row = await _screen(session, project, screen_id)
    return await _launch(
        session,
        background,
        user,
        project,
        kind="variants",
        prompt=body.prompt.strip(),
        params={
            "screen_id": str(row.id),
            "count": body.count,
            "creative_range": body.creative_range,
            "aspects": list(body.aspects),
            "device_type": row.device_type,
            "model_id": body.model_id or get_settings().stitch_default_model,
        },
    )


@router.post(
    "/api/projects/{project_id}/stitch/sync", status_code=status.HTTP_202_ACCEPTED
)
async def sync(
    project_id: uuid.UUID,
    session: Session,
    user: CurrentUser,
    background: BackgroundTasks,
) -> dict[str, Any]:
    """Imports screens the linked Stitch project has that Karkhana has not seen."""
    project = await _designer_project(session, user, project_id)
    if await session.get(StitchProject, project.id) is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Generate a screen first; there is no Stitch project to sync yet.",
        )
    return await _launch(
        session, background, user, project, kind="sync", prompt="", params={}
    )


@router.get("/api/projects/{project_id}/stitch/jobs/{job_id}")
async def job_status(
    project_id: uuid.UUID, job_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """One job's progress."""
    project = await _designer_project(session, user, project_id, need_service=False)
    await stitch_design.expire_stale(session, project.id)
    job = await session.get(StitchJob, job_id)
    if job is None or job.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found.")
    return stitch_design.job_out(job)


@router.get("/api/projects/{project_id}/stitch/screens/{screen_id}/preview")
async def preview(
    project_id: uuid.UUID, screen_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """The screen's HTML wrapped for a sandboxed frame (see ``preview_document``)."""
    project = await _designer_project(session, user, project_id, need_service=False)
    row = await _screen(session, project, screen_id, with_=("html",))
    if not row.html:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "This screen has no HTML yet. Try Sync."
        )
    return {
        "id": str(row.id),
        "title": row.title,
        "srcdoc": stitch_design.preview_document(row.html),
    }


_SAFE_FILE = re.compile(r"[^A-Za-z0-9._-]+")


@router.get("/api/projects/{project_id}/stitch/screens/{screen_id}/html")
async def download_html(
    project_id: uuid.UUID, screen_id: uuid.UUID, session: Session, user: CurrentUser
) -> Response:
    """The raw HTML as a download. Never rendered on the app's origin."""
    project = await _designer_project(session, user, project_id, need_service=False)
    row = await _screen(session, project, screen_id, with_=("html",))
    if not row.html:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This screen has no HTML yet.")
    name = (_SAFE_FILE.sub("-", row.title).strip("-") or "screen")[:80]
    return Response(
        row.html,
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{name}.html"',
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.get("/api/projects/{project_id}/stitch/screens/{screen_id}/screenshot")
async def screenshot(
    project_id: uuid.UUID, screen_id: uuid.UUID, session: Session, user: CurrentUser
) -> Response:
    """The screenshot image."""
    project = await _designer_project(session, user, project_id, need_service=False)
    row = await _screen(session, project, screen_id, with_=("screenshot",))
    if not row.screenshot or not row.screenshot_type:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This screen has no screenshot.")
    return Response(
        row.screenshot,
        media_type=row.screenshot_type,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
            "Cache-Control": "private, max-age=300",
        },
    )


@router.patch("/api/projects/{project_id}/stitch/screens/{screen_id}")
async def patch_screen(
    project_id: uuid.UUID,
    screen_id: uuid.UUID,
    body: ScreenPatch,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Pins or unpins a screen for the developer handoff."""
    project = await _designer_project(session, user, project_id, need_service=False)
    row = await _screen(session, project, screen_id)
    if row.pinned != body.pinned:
        row.pinned = body.pinned
        await ledger.append(
            session,
            actor=ledger.Actor.human(user),
            action="stitch.screen.pinned" if body.pinned else "stitch.screen.unpinned",
            subject_type="stitch_screen",
            subject_id=row.id,
            project_id=project.id,
            payload={"title": row.title, "stitch_screen_id": row.stitch_screen_id},
        )
        await session.commit()
    return stitch_design.screen_out(row)


@router.delete(
    "/api/projects/{project_id}/stitch/screens/{screen_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def archive_screen(
    project_id: uuid.UUID, screen_id: uuid.UUID, session: Session, user: CurrentUser
) -> Response:
    """Archives a screen (kept for the audit trail; hidden and unpinned)."""
    project = await _designer_project(session, user, project_id, need_service=False)
    row = await _screen(session, project, screen_id)
    row.archived_at, row.pinned = dt.datetime.now(dt.UTC), False
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="stitch.screen.archived",
        subject_type="stitch_screen",
        subject_id=row.id,
        project_id=project.id,
        payload={"title": row.title, "stitch_screen_id": row.stitch_screen_id},
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
