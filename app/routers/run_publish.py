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

"""The developer decides when and where a finished build becomes a pull request.

A green build on a developer's machine stays local (run phase ``built``). The
developer reviews the change, then raises the pull request: they choose the
branch it goes to, and may name the head branch and the title.

Endpoints:
  GET  /api/projects/{id}/branches   — the repository's branches and its default
  GET  /api/runs/{id}/diff           — the built change, before any pull request exists
  POST /api/runs/{id}/publish        — push it and open the pull request
  POST /api/runs/{id}/cancel         — stop a run that is queued or running
"""

from __future__ import annotations

import re
import uuid
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import access
from app.auth import CurrentUser
from app.config import get_settings
from app.db import get_session
from app.models import AgentJob, Project, PullRequest, Run, Task
from app.review.diff import diff_to_json, parse_unified_diff
from app.routers import runs
from app.schemas import RunResult
from app.services import repos
from app.services.realtime import notify_workspace

router = APIRouter(tags=["run-publish"])
Session = Annotated[AsyncSession, Depends(get_session)]

_BRANCH = re.compile(r"^(?!-)(?!.*\.\.)(?!.*//)[A-Za-z0-9._/-]{1,100}$")


async def _developer_project(
    session: AsyncSession, user: Any, project_id: uuid.UUID
) -> Project:
    project = await access.get_visible_project(session, user, project_id)
    await access.ensure_station(session, user, project, "developer")
    return project


async def _github_branches(
    session: AsyncSession, project: Project, user: Any
) -> tuple[str, list[str]] | None:
    """``(default branch, branch names)`` of the project's repository, or ``None`` when GitHub is not reachable."""
    target = await repos.for_project(session, project.id)
    token = await repos.write_token(session, project.id, user.id)
    if target is None or not token:
        return None
    s = get_settings()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "software-karkhana",
    }
    names: list[str] = []
    try:
        async with httpx.AsyncClient(
            base_url=s.github_api_url, headers=headers, timeout=15
        ) as http:
            repo = await http.get(f"/repos/{target.slug}")
            if repo.status_code != 200:
                return None
            default = repo.json().get("default_branch") or target.base_branch
            for page in (1, 2, 3):
                r = await http.get(
                    f"/repos/{target.slug}/branches",
                    params={"per_page": 100, "page": page},
                )
                if r.status_code != 200:
                    break
                batch = [b["name"] for b in r.json()]
                names += batch
                if len(batch) < 100:
                    break
    except httpx.HTTPError:
        return None
    return default, sorted(set(names))


@router.get("/api/projects/{project_id}/branches")
async def branches(
    project_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """The branches a pull request can go to, with the repository's default first."""
    project = await _developer_project(session, user, project_id)
    target = await repos.for_project(session, project.id)
    found = await _github_branches(session, project, user)
    default = (
        found[0]
        if found
        else (target.base_branch if target else get_settings().github_base_branch)
    )
    names = found[1] if found else []
    ordered = (
        [default, *[n for n in names if n != default]]
        if default in names or not names
        else [default, *names]
    )
    return {
        "repo": target.slug if target else None,
        "default": default,
        "branches": ordered,
        "reachable": found is not None,
    }


async def _built_run(
    session: AsyncSession, user: Any, run_id: uuid.UUID, *, lock: bool = False
) -> tuple[Run, Project, Task]:
    stmt = select(Run).where(Run.id == run_id)
    run = await session.scalar(stmt.with_for_update() if lock else stmt)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found.")
    project = await _developer_project(session, user, run.project_id)
    task = await session.get(Task, run.task_id)
    assert task is not None
    return run, project, task


@router.get("/api/runs/{run_id}/diff")
async def run_diff(
    run_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """The change a build produced, in the same shape as a pull request's diff (no comments yet)."""
    run, _project, _task = await _built_run(session, user, run_id)
    files = parse_unified_diff(run.patch or "")
    return {
        "prId": str(run.id),
        "number": 0,
        "truncated": False,
        "additions": sum(f.additions for f in files),
        "deletions": sum(f.deletions for f in files),
        "files": diff_to_json(files),
        "comments": [],
        "unplaced": [],
    }


class PublishIn(BaseModel):
    """Where the pull request goes and what it is called."""

    base_branch: str | None = Field(
        default=None,
        max_length=200,
        description="Empty: the repository's default branch.",
    )
    branch: str | None = Field(
        default=None,
        max_length=100,
        description="Head branch name; empty: karkhana/<story>-<run>.",
    )
    title: str | None = Field(default=None, min_length=3, max_length=200)


@router.post("/api/runs/{run_id}/publish", status_code=status.HTTP_201_CREATED)
async def publish(
    run_id: uuid.UUID,
    body: PublishIn,
    background: BackgroundTasks,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Pushes the built change and opens the pull request against the branch the developer chose."""
    run, project, task = await _built_run(session, user, run_id, lock=True)
    existing = await session.scalar(
        select(PullRequest).where(PullRequest.run_id == run.id)
    )
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Pull request #{existing.number} was already raised for this build.",
        )
    if not (run.status == "succeeded" and run.phase == "built"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only a finished, green build can be raised as a pull request.",
        )
    if run.validation_status != "passed":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This build's tests did not pass, so it cannot be raised.",
        )

    head = (body.branch or "").strip() or None
    if head and (not _BRANCH.match(head) or head.endswith((".lock", "/", "."))):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "A branch name uses letters, digits and . _ - / only (for example feature/udhaar-entries).",
        )
    found = await _github_branches(session, project, user)
    base = (body.base_branch or "").strip() or (found[0] if found else None)
    if found:
        default, names = found
        base = base or default
        if base not in names:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"The branch '{base}' does not exist in the repository. Pick one of: {', '.join(names[:12])}.",
            )
        if head and head in names:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"The branch '{head}' already exists. Pick another name for this change.",
            )
        if head and head == base:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "The change needs its own branch, not the one it goes into.",
            )

    result = RunResult(
        ok=True,
        patch=run.patch,
        test_command=run.test_command,
        test_exit_code=run.test_exit_code,
        test_output=run.test_output,
        reviewed=False,
        publish=True,
    )
    await runs.publish_run(
        session,
        run,
        result,
        background,
        base_branch=base,
        branch_name=head,
        title=(body.title or "").strip() or None,
    )
    pr = await session.scalar(select(PullRequest).where(PullRequest.run_id == run.id))
    assert pr is not None
    return {
        "number": pr.number,
        "url": pr.url,
        "branch": pr.branch,
        "base": base,
        "task": task.key,
    }


@router.post("/api/runs/{run_id}/cancel")
async def cancel(
    run_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Stops a build that is queued or running. The agent hears it on its next heartbeat; partial work stays on the machine."""
    run, project, _task = await _built_run(session, user, run_id, lock=True)
    if run.status not in ("queued", "running"):
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"This run is already {run.status}."
        )
    await runs._finish_failed(
        session, run, "cancelled", f"Stopped by {user.display_name}."
    )
    # A job the machine has not picked up yet must never start.
    await session.execute(
        update(AgentJob)
        .where(AgentJob.run_id == run.id, AgentJob.status == "queued")
        .values(status="cancelled")
    )
    await session.commit()
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "runs")
    return {"status": run.status}
