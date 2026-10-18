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

"""Google Stitch on the designer dashboard.

Who: only people on the project's ``design`` station. Unlike the rest of the
project (where an *open* project lets every workspace member in), Stitch is a
paid, quota-limited external tool that produces design decisions, so it needs
an explicit design seat even on open projects. Leads and managers who want it
give themselves the design station; that choice is visible and audited.

What: a designer writes a brief (optionally citing approved stories). A
background job asks Stitch for a screen, an edit, or variants, then copies the
HTML and screenshot into ``stitch_screens`` so the design does not depend on
Stitch's expiring links. Designers pin the screens that matter; pinned screens
are listed in the design handoff developers receive when the design is approved.

Safety:
- One running job per project (a partial unique index), a rolling 24-hour
  generation budget per workspace, and jobs left ``running`` by a dead
  instance are failed after the timeout so they never block the project.
- If a generation call drops mid-flight, Stitch may still finish it; the job
  then lists the Stitch project's screens and imports any it has not seen.
- Stitch HTML loads Tailwind and Google Fonts from CDNs, so previews run in a
  sandboxed frame (opaque origin) under an injected CSP that blocks network
  calls, forms, frames and navigation.
"""

from __future__ import annotations

import datetime as dt
import html as html_lib
import logging
import re
import uuid
from collections.abc import Iterable
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import ledger
from app.config import get_settings
from app.db import sessionmaker
from app.integrations import stitch
from app.models import (
    Project,
    ProjectMember,
    StitchJob,
    StitchProject,
    StitchScreen,
    Task,
    User,
)
from app.services.realtime import notify_workspace

logger = logging.getLogger(__name__)

STATION = "design"
GENERATING_KINDS = ("generate", "edit", "variants")
MAX_PROMPT_CHARS = 4000
MAX_STORIES = 12
# A job still "running" this long after its timeout belongs to a dead instance.
STALE_GRACE = dt.timedelta(minutes=5)


# --------------------------------------------------------------------------
# Access
# --------------------------------------------------------------------------


def decide(
    *, member_stations: Iterable[str] | None, archived: bool = False
) -> tuple[bool, str]:
    """Whether someone may use Stitch on a project. Pure; unit-tested.

    Args:
        member_stations: Their stations on the project, or ``None`` if they are
            not on the project team at all.
        archived: The project is archived (read-only).
    """
    if archived:
        return False, "This project is archived."
    if member_stations is None or STATION not in set(member_stations):
        return (
            False,
            "Google Stitch is available to the project's designers only. Ask the project lead for the design station.",
        )
    return True, ""


async def _member_stations(
    session: AsyncSession, user: Any, project: Project
) -> list[str] | None:
    member = await session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id, ProjectMember.user_id == user.id
        )
    )
    return list(member.stations or []) if member else None


async def can_use(
    session: AsyncSession, user: Any, project: Project
) -> tuple[bool, str]:
    """Designer check for the signed-in user."""
    return decide(
        member_stations=await _member_stations(session, user, project),
        archived=project.archived_at is not None,
    )


async def require_designer(
    session: AsyncSession, user: Any, project: Project, *, need_service: bool = True
) -> None:
    """403 unless the caller is a designer here; 503 if Stitch is off (when needed)."""
    ok, why = await can_use(session, user, project)
    if not ok:
        raise HTTPException(status.HTTP_403_FORBIDDEN, why)
    if need_service and not get_settings().stitch_configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Google Stitch is not enabled on this server.",
        )


# --------------------------------------------------------------------------
# Quota and jobs
# --------------------------------------------------------------------------


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


async def quota(
    session: AsyncSession, workspace_id: uuid.UUID | None
) -> dict[str, int]:
    """Generations used by the workspace in the last 24 hours, and the limit."""
    limit = get_settings().stitch_daily_limit_per_workspace
    if workspace_id is None:
        return {"used": 0, "limit": limit}
    used = await session.scalar(
        select(func.count(StitchJob.id)).where(
            StitchJob.workspace_id == workspace_id,
            StitchJob.kind.in_(GENERATING_KINDS),
            StitchJob.created_at > _now() - dt.timedelta(hours=24),
        )
    )
    return {"used": int(used or 0), "limit": limit}


async def expire_stale(session: AsyncSession, project_id: uuid.UUID) -> None:
    """Fails jobs a dead instance left running, so the project is not blocked forever."""
    cutoff = (
        _now() - dt.timedelta(seconds=get_settings().stitch_timeout_s) - STALE_GRACE
    )
    res = await session.execute(
        update(StitchJob)
        .where(
            StitchJob.project_id == project_id,
            StitchJob.status == "running",
            StitchJob.created_at < cutoff,
        )
        .values(
            status="failed",
            finished_at=_now(),
            error="The job was interrupted. Use Sync to import any screens Stitch finished.",
        )
    )
    if res.rowcount:
        await session.commit()


async def start_job(
    session: AsyncSession,
    user: User,
    project: Project,
    *,
    kind: str,
    prompt: str = "",
    params: dict[str, Any] | None = None,
) -> StitchJob:
    """Records a running job (409 if one is running, 429 over quota) and ledgers it."""
    await expire_stale(session, project.id)
    if kind in GENERATING_KINDS:
        q = await quota(session, project.workspace_id)
        if q["used"] >= q["limit"]:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"This workspace has used its {q['limit']} Stitch generations for the last 24 hours.",
            )
    job = StitchJob(
        project_id=project.id,
        workspace_id=project.workspace_id,
        kind=kind,
        status="running",
        prompt=prompt,
        params=params or {},
        created_by=user.id,
    )
    session.add(job)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A Stitch job is already running for this project. Wait for it to finish.",
        ) from exc
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action=f"stitch.{kind}.requested",
        subject_type="project",
        subject_id=project.id,
        project_id=project.id,
        payload={
            "job_id": str(job.id),
            **{k: v for k, v in (params or {}).items() if k != "story_context"},
        },
    )
    await session.commit()
    return job


# --------------------------------------------------------------------------
# Prompts
# --------------------------------------------------------------------------


async def build_prompt(
    session: AsyncSession, project: Project, brief: str, story_keys: list[str]
) -> str:
    """The designer's brief, plus the acceptance criteria of the stories it cites."""
    brief = brief.strip()[:MAX_PROMPT_CHARS]
    keys = list(dict.fromkeys(k.strip() for k in story_keys if k.strip()))[:MAX_STORIES]
    if not keys:
        return brief
    tasks = (
        await session.scalars(
            select(Task).where(Task.project_id == project.id, Task.key.in_(keys))
        )
    ).all()
    found = {t.key for t in tasks}
    missing = [k for k in keys if k not in found]
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Unknown stories: {', '.join(missing)}.",
        )
    lines = [
        brief,
        "",
        f"Product: {project.name}. The screen must satisfy these user stories:",
    ]
    for t in sorted(tasks, key=lambda x: keys.index(x.key)):
        criteria = t.acceptance_criteria or []
        if isinstance(criteria, str):
            criteria = [criteria]
        lines.append(
            f"- {t.key} {t.title}"
            + (": " + "; ".join(str(c) for c in criteria[:6]) if criteria else "")
        )
    return "\n".join(lines)[: MAX_PROMPT_CHARS * 2]


# --------------------------------------------------------------------------
# The background job
# --------------------------------------------------------------------------


def make_client() -> stitch.StitchClient:
    """The configured client. Tests replace this."""
    s = get_settings()
    return stitch.StitchClient(
        api_key=s.stitch_api_key or "",
        endpoint=s.stitch_mcp_url,
        timeout_s=s.stitch_timeout_s,
    )


async def fetch_asset(url: str, *, max_bytes: int) -> tuple[bytes, str]:
    """Downloads a generated asset from an allowlisted host. Tests replace this."""
    s = get_settings()
    return await stitch.download(
        url, allowed_suffixes=s.stitch_asset_host_list, max_bytes=max_bytes
    )


def image_type(data: bytes) -> str | None:
    """Content type from magic bytes (never trust the server's header)."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def _stitch_project(
    session: AsyncSession,
    client: stitch.StitchClient,
    project: Project,
    user_id: uuid.UUID | None,
) -> str:
    row = await session.get(StitchProject, project.id)
    if row:
        return row.stitch_project_id
    sid = await client.create_project(f"Karkhana · {project.name}")
    if not re.fullmatch(r"[0-9A-Za-z_-]{1,64}", sid):
        raise stitch.StitchError(
            "BAD_RESPONSE", "Stitch returned an unexpected project id."
        )
    session.add(
        StitchProject(project_id=project.id, stitch_project_id=sid, created_by=user_id)
    )
    await session.commit()
    return sid


async def _import_screen(
    session: AsyncSession,
    client: stitch.StitchClient,
    *,
    project: Project,
    stitch_project_id: str,
    screen: stitch.StitchScreen,
    job: StitchJob | None,
    prompt: str,
    parent_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
) -> tuple[StitchScreen, list[str]]:
    """Inserts or refreshes one screen, copying its HTML and screenshot. Returns warnings."""
    s = get_settings()
    warnings: list[str] = []
    if not re.fullmatch(r"[0-9A-Za-z_-]{1,128}", screen.screen_id):
        raise stitch.StitchError(
            "BAD_RESPONSE", "Stitch returned an unexpected screen id."
        )
    if not (screen.html_url and screen.screenshot_url):
        try:
            full = await client.get_screen(stitch_project_id, screen.screen_id)
            if full:
                screen.html_url = screen.html_url or full.html_url
                screen.screenshot_url = screen.screenshot_url or full.screenshot_url
        except stitch.StitchError as exc:
            warnings.append(f"{screen.title}: {exc.message}")

    html_text: str | None = None
    if screen.html_url:
        try:
            body, _ = await fetch_asset(
                screen.html_url, max_bytes=s.stitch_max_html_bytes
            )
            html_text = body.decode("utf-8", errors="replace")
        except stitch.StitchError as exc:
            warnings.append(f"{screen.title} HTML: {exc.message}")
    shot: bytes | None = None
    shot_type: str | None = None
    if screen.screenshot_url:
        try:
            data, _ = await fetch_asset(
                screen.screenshot_url, max_bytes=s.stitch_max_screenshot_bytes
            )
            shot_type = image_type(data)
            if shot_type:
                shot = data
            else:
                warnings.append(
                    f"{screen.title}: the screenshot is not a PNG, JPEG or WebP image."
                )
        except stitch.StitchError as exc:
            warnings.append(f"{screen.title} screenshot: {exc.message}")

    row = await session.scalar(
        select(StitchScreen).where(
            StitchScreen.project_id == project.id,
            StitchScreen.stitch_screen_id == screen.screen_id,
        )
    )
    if row is None:
        row = StitchScreen(
            project_id=project.id,
            stitch_screen_id=screen.screen_id,
            job_id=job.id if job else None,
            parent_id=parent_id,
            prompt=prompt[: MAX_PROMPT_CHARS * 2],
            created_by=user_id,
        )
        session.add(row)
    elif prompt:
        row.prompt = prompt[: MAX_PROMPT_CHARS * 2]
        row.job_id = job.id if job else row.job_id
    row.title = screen.title
    row.device_type = screen.device_type
    row.width, row.height = screen.width, screen.height
    if html_text is not None:
        row.html = html_text
    if shot is not None:
        row.screenshot, row.screenshot_type = shot, shot_type
    row.archived_at = None
    await session.flush()
    return row, warnings


async def _known_ids(session: AsyncSession, project_id: uuid.UUID) -> set[str]:
    return set(
        (
            await session.scalars(
                select(StitchScreen.stitch_screen_id).where(
                    StitchScreen.project_id == project_id
                )
            )
        ).all()
    )


async def run_job(job_id: uuid.UUID) -> None:
    """Background task: performs the Stitch call a job describes and imports the screens."""
    async with sessionmaker()() as session:
        job = await session.get(StitchJob, job_id)
        if job is None or job.status != "running":
            return
        project = await session.get(Project, job.project_id)
        if project is None:
            return
        user_id = job.created_by
        p = job.params or {}
        imported: list[str] = []
        warnings: list[str] = []
        messages: list[str] = []
        suggestions: list[str] = []
        sid: str | None = None
        client: stitch.StitchClient | None = None
        known: set[str] = set()
        try:
            client = make_client()
            sid = await _stitch_project(session, client, project, user_id)
            known = await _known_ids(session, project.id)
            parent: StitchScreen | None = None
            if job.kind in ("edit", "variants"):
                parent = await session.get(StitchScreen, uuid.UUID(p["screen_id"]))
                if parent is None or parent.project_id != project.id:
                    raise stitch.StitchError(
                        "NOT_FOUND", "The screen to change no longer exists."
                    )

            if job.kind == "sync":
                screens = await client.list_screens(sid)
                todo = [x for x in screens if x.screen_id not in known]
                result = stitch.GenerationResult(screens=todo)
            elif job.kind == "generate":
                result = await client.generate(
                    sid, job.prompt, p.get("device_type"), p.get("model_id")
                )
            elif job.kind == "edit":
                assert parent is not None
                result = await client.edit(
                    sid,
                    [parent.stitch_screen_id],
                    job.prompt,
                    p.get("device_type"),
                    p.get("model_id"),
                )
            else:
                assert parent is not None
                result = await client.variants(
                    sid,
                    [parent.stitch_screen_id],
                    job.prompt,
                    count=int(p.get("count", 3)),
                    creative_range=p.get("creative_range", "EXPLORE"),
                    aspects=list(p.get("aspects") or []),
                    device_type=p.get("device_type"),
                    model_id=p.get("model_id"),
                )
            messages, suggestions = result.messages, result.suggestions
            for scr in result.screens:
                row, warn = await _import_screen(
                    session,
                    client,
                    project=project,
                    stitch_project_id=sid,
                    screen=scr,
                    job=job,
                    prompt=job.prompt,
                    parent_id=parent.id
                    if parent
                    else None,  # used only for new screens
                    user_id=user_id,
                )
                imported.append(str(row.id))
                warnings += warn
            if job.kind != "sync" and not result.screens:
                raise stitch.StitchError(
                    "BAD_RESPONSE",
                    "Stitch finished without returning a screen."
                    + (f" It said: {messages[0]}" if messages else ""),
                )
            await _finish(
                session,
                job,
                project,
                "succeeded",
                imported,
                warnings,
                messages,
                suggestions,
            )
        except stitch.StitchError as exc:
            await session.rollback()
            job = await session.get(StitchJob, job_id)
            project = await session.get(Project, job.project_id) if job else None
            if job is None or project is None:
                return
            # A dropped generation may have finished anyway: import what Stitch has.
            if (
                exc.recoverable
                and client is not None
                and sid is not None
                and job.kind in GENERATING_KINDS
            ):
                try:
                    for scr in await client.list_screens(sid):
                        if scr.screen_id in known:
                            continue
                        row, warn = await _import_screen(
                            session,
                            client,
                            project=project,
                            stitch_project_id=sid,
                            screen=scr,
                            job=job,
                            prompt=job.prompt,
                            parent_id=None,
                            user_id=user_id,
                        )
                        imported.append(str(row.id))
                        warnings += warn
                except stitch.StitchError as again:
                    logger.warning(
                        "Stitch reconcile failed for job %s: %s", job_id, again.message
                    )
                if imported:
                    await _finish(
                        session,
                        job,
                        project,
                        "succeeded",
                        imported,
                        [
                            *warnings,
                            "The connection dropped; screens were recovered from Stitch.",
                        ],
                        messages,
                        suggestions,
                    )
                    return
            logger.warning("Stitch job %s failed: %s %s", job_id, exc.code, exc.message)
            await _finish(
                session,
                job,
                project,
                "failed",
                imported,
                warnings,
                messages,
                suggestions,
                error=_user_error(exc),
            )
        except Exception:
            logger.exception("Stitch job %s crashed", job_id)
            await session.rollback()
            job = await session.get(StitchJob, job_id)
            project = await session.get(Project, job.project_id) if job else None
            if job and project:
                await _finish(
                    session,
                    job,
                    project,
                    "failed",
                    [],
                    [],
                    [],
                    [],
                    error="Unexpected error while talking to Google Stitch.",
                )


def _user_error(exc: stitch.StitchError) -> str:
    hints = {
        "AUTH_FAILED": "The server's Stitch API key was rejected. Ask an administrator to rotate it.",
        "PERMISSION_DENIED": "The server's Stitch key cannot use this Stitch project.",
        "RATE_LIMITED": "Google Stitch's quota is used up for now. Try again later.",
        "TIMEOUT": "Google Stitch took too long. Use Sync in a few minutes to import the result.",
        "NOT_CONFIGURED": "Google Stitch is not configured on this server.",
    }
    return (hints.get(exc.code) or exc.message)[:1000]


async def _finish(
    session: AsyncSession,
    job: StitchJob,
    project: Project,
    outcome: str,
    imported: list[str],
    warnings: list[str],
    messages: list[str],
    suggestions: list[str],
    *,
    error: str | None = None,
) -> None:
    job.status = outcome
    job.finished_at = _now()
    job.error = error
    job.result = {
        "screen_ids": imported,
        "warnings": warnings[:20],
        "messages": messages[:5],
        "suggestions": suggestions[:6],
    }
    await ledger.append(
        session,
        actor=ledger.Actor.ai("google-stitch"),
        action=f"stitch.{job.kind}.{outcome}",
        subject_type="project",
        subject_id=project.id,
        project_id=project.id,
        payload={"job_id": str(job.id), "screens": len(imported), "error": error},
    )
    await session.commit()
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "stitch")


# --------------------------------------------------------------------------
# Views
# --------------------------------------------------------------------------

PREVIEW_CSP = (
    "default-src 'none'; "
    "script-src 'unsafe-inline' https://cdn.tailwindcss.com; "
    "style-src 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com data:; "
    "img-src https: data: blob:; "
    "media-src https: data:; "
    "connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; "
    "form-action 'none'; base-uri 'none'"
)
_STRIP = re.compile(
    r"<base\b[^>]*>|<meta\b[^>]*http-equiv\s*=\s*[\"']?refresh[^>]*>",
    re.I,
)
_HEAD = re.compile(r"<head\b[^>]*>", re.I)


def preview_document(raw_html: str) -> str:
    """Stitch HTML wrapped for a sandboxed ``srcdoc`` frame under a strict CSP.

    The frame itself must be ``sandbox="allow-scripts"`` *without*
    ``allow-same-origin``: an opaque origin with no cookies, storage or access
    to the app. The CSP is the first thing in ``<head>`` so it applies to every
    script; it lets Tailwind's CDN and Google Fonts render the design and
    blocks network calls, forms, nested frames and ``<base>`` tricks.
    """
    cleaned = _STRIP.sub("", raw_html)
    meta = f'<meta http-equiv="Content-Security-Policy" content="{html_lib.escape(PREVIEW_CSP, quote=True)}">'
    match = _HEAD.search(cleaned)
    if match:
        return cleaned[: match.end()] + meta + cleaned[match.end() :]
    return (
        f"<!doctype html><html><head>{meta}</head><body>{cleaned}</body></html>"
        if "<html" not in cleaned.lower()
        else meta + cleaned
    )


def screen_out(row: StitchScreen) -> dict[str, Any]:
    """A screen for the API (no HTML or image bytes)."""
    return {
        "id": str(row.id),
        "stitchScreenId": row.stitch_screen_id,
        "title": row.title,
        "prompt": row.prompt,
        "deviceType": row.device_type,
        "width": row.width,
        "height": row.height,
        "pinned": row.pinned,
        "parentId": str(row.parent_id) if row.parent_id else None,
        "hasScreenshot": row.screenshot_type is not None,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
    }


def job_out(job: StitchJob) -> dict[str, Any]:
    """A job for the API."""
    return {
        "id": str(job.id),
        "kind": job.kind,
        "status": job.status,
        "prompt": job.prompt,
        "error": job.error,
        "result": job.result or {},
        "createdAt": job.created_at.isoformat() if job.created_at else None,
        "finishedAt": job.finished_at.isoformat() if job.finished_at else None,
    }


async def pinned_for_handoff(
    session: AsyncSession, project_id: uuid.UUID
) -> list[StitchScreen]:
    """Pinned, live screens, for the design handoff."""
    return list(
        (
            await session.scalars(
                select(StitchScreen)
                .where(
                    StitchScreen.project_id == project_id,
                    StitchScreen.pinned.is_(True),
                    StitchScreen.archived_at.is_(None),
                )
                .order_by(StitchScreen.created_at)
            )
        ).all()
    )
