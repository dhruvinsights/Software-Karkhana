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

"""Agent runs: start (A8), status polling, and worker callbacks (A9, A10)."""

from __future__ import annotations

import datetime as dt
import hashlib
import logging
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, agent_memory, ledger, publisher
from app.auth import CurrentUser
from app.config import get_settings
from app.db import get_session
from app.integrations import github
from app.models import (
    ContextEntry,
    Project,
    PullRequest,
    ReviewComment,
    Run,
    Task,
)
from app.process import Event, Role
from app.review import engine as review_engine
from app.review.diff import anchor_comments
from app.routers.common import (
    advance_if_legal,
    advance_or_http,
    get_or_404,
    lock_project,
)
from app.runner.base import get_backend, verify_run_token
from app.schemas import (
    ContextNote,
    RunOut,
    RunProgress,
    RunResult,
    RunSpec,
    SuiteReport,
)
from app.services import context_notes, plan, repos, test_suites
from app.services.realtime import notify_workspace

logger = logging.getLogger(__name__)
router = APIRouter(tags=["runs"])
Session = Annotated[AsyncSession, Depends(get_session)]
TERMINAL = {"succeeded", "failed", "timed_out", "cancelled"}
CODER = ledger.Actor.ai("coder-agent")
REVIEWER = ledger.Actor.ai("reviewer-agent")


async def _announce(session: AsyncSession, project_id: uuid.UUID) -> None:
    """Commits, then tells the project's open tabs that its runs changed."""
    await session.commit()
    project = await session.get(Project, project_id)
    if project is not None and project.workspace_id:
        await notify_workspace(project.workspace_id, "runs")


class RunStartIn(BaseModel):
    """Where to run: the configured backend, or the caller's machine."""

    backend: Literal["device"] | None = None


@router.post(
    "/api/tasks/{task_id}/runs",
    response_model=RunOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_run(
    task_id: uuid.UUID,
    session: Session,
    user: CurrentUser,
    body: RunStartIn | None = None,
) -> Run:
    """Developer clicks "Build". The process engine decides if it may run.

    The caller must be a developer or lead *in the project's workspace*.
    ``backend: "device"`` builds on the caller's own connected machine.
    """
    task = await get_or_404(session, Task, task_id)
    project = await lock_project(session, task.project_id)  # Serializes admission.
    my_role = await access.require_project_role(
        session, user, project, Role.DEVELOPER, Role.LEAD
    )
    await access.ensure_station(session, user, project, "developer")
    if task.status != "ready":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{task.key} is {task.status}; only Ready tasks can be assigned",
        )
    active = await session.scalar(
        select(func.count())
        .select_from(Run)
        .where(Run.project_id == project.id, Run.status.in_(["queued", "running"]))
    )
    if active >= get_settings().max_active_runs_per_project:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many active runs for this project"
        )

    backend = get_backend(body.backend if body else None)
    actor = ledger.Actor.human(user)
    await advance_or_http(
        session,
        project,
        Event.RUN_STARTED,
        actor=actor,
        role=Role(my_role),
        payload={"task": task.key},
    )
    await plan.move_task(session, task, "in_progress")
    task.assignee_id = user.id
    run = Run(
        id=uuid.uuid4(),
        task_id=task.id,
        project_id=project.id,
        backend=backend.name,
        requested_by=user.id,
        status="queued",
        phase="queued",
    )
    session.add(run)
    await session.flush()
    await ledger.append(
        session,
        actor=actor,
        action="run.requested",
        subject_type="run",
        subject_id=run.id,
        project_id=project.id,
        payload={"task": task.key, **backend.describe()},
    )
    # Commit before starting so the worker can read its spec immediately.
    await session.commit()

    try:
        started = await backend.start(run.id, run.env_class)
    except Exception as exc:
        logger.exception("Backend failed to start run %s", run.id)
        run.status, run.error, run.finished_at = (
            "failed",
            f"backend start failed: {exc}",
            dt.datetime.now(dt.UTC),
        )
        await plan.move_task(session, task, "ready")
        await advance_if_legal(session, project, Event.RUN_FAILED, actor=ledger.SYSTEM)
        await ledger.append(
            session,
            actor=ledger.SYSTEM,
            action="run.failed",
            subject_type="run",
            subject_id=run.id,
            project_id=project.id,
            payload={"error": str(exc)[:300]},
        )
        await _announce(session, project.id)
        return run
    run.external_id, run.status, run.started_at = (
        started.external_id,
        "running",
        dt.datetime.now(dt.UTC),
    )
    run.heartbeat_at = run.started_at
    await ledger.append(
        session,
        actor=ledger.SYSTEM,
        action="run.started",
        subject_type="run",
        subject_id=run.id,
        project_id=project.id,
        payload={"external_id": started.external_id},
    )
    await _announce(session, project.id)
    return run


@router.get("/api/runs/{run_id}", response_model=RunOut)
async def get_run(
    run_id: uuid.UUID,
    session: Session,
    user: CurrentUser,
) -> Run:
    """Polled by the browser. Marks silent runs as timed out (ADR-001 reliability rules)."""
    run = await get_or_404(session, Run, run_id)
    await access.get_visible_project(session, user, run.project_id)
    timeout = dt.timedelta(seconds=get_settings().run_heartbeat_timeout_sec)
    if (
        run.status == "running"
        and run.heartbeat_at
        and dt.datetime.now(dt.UTC) - run.heartbeat_at > timeout
    ):
        backend_view = await get_backend().status(run.external_id or "")
        if backend_view.state != "running":
            await _finish_failed(
                session,
                run,
                "timed_out",
                f"no heartbeat; backend says {backend_view.state}",
            )
    return run


@router.get("/api/tasks/{task_id}/runs", response_model=list[RunOut])
async def list_task_runs(
    task_id: uuid.UUID,
    session: Session,
    user: CurrentUser,
) -> list[Run]:
    """Run history for a task."""
    task = await get_or_404(session, Task, task_id)
    await access.get_visible_project(session, user, task.project_id)
    return list(
        (
            await session.scalars(
                select(Run)
                .where(Run.task_id == task_id)
                .order_by(Run.created_at.desc())
            )
        ).all()
    )


# --- Worker callbacks: authenticated by per-run HMAC, not by a user ----------


async def _run_for_worker(
    session: AsyncSession, run_id: uuid.UUID, authorization: str | None
) -> Run:
    token = (authorization or "").removeprefix("Run ").strip()
    if not token or not verify_run_token(run_id, token):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad run token")
    return await get_or_404(session, Run, run_id)


@router.get(
    "/internal/runs/{run_id}/spec", response_model=RunSpec, include_in_schema=False
)
async def run_spec(
    run_id: uuid.UUID,
    session: Session,
    authorization: Annotated[str | None, Header()] = None,
) -> RunSpec:
    """What the worker should build."""
    run = await _run_for_worker(session, run_id, authorization)
    task = await get_or_404(session, Task, run.task_id)
    project = await get_or_404(session, Project, run.project_id)  # Read-only.
    s = get_settings()
    notes = context_notes.as_notes(await context_notes.recent(session, run.project_id))
    notes += [
        ContextNote(kind="memory", title="Project memory", body=m, author="mem0")
        for m in await agent_memory.recall(
            run.project_id, f"{task.title}\n{task.description}", role="developer"
        )
    ]
    target = await repos.for_project(session, project.id)
    return RunSpec(
        run_id=run.id,
        task_key=task.key,
        task_title=task.title,
        task_description=task.description,
        acceptance_criteria=task.acceptance_criteria,
        project_name=project.name,
        repo=target.slug if target else None,
        repo_url=s.demo_repo_url or (target.clone_url if target else None),
        base_branch=target.base_branch if target else s.github_base_branch,
        context=notes,
    )


@router.post("/internal/runs/{run_id}/progress", include_in_schema=False)
async def run_progress(
    run_id: uuid.UUID,
    body: RunProgress,
    session: Session,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    """Heartbeat with phase."""
    run = await _run_for_worker(session, run_id, authorization)
    if run.status in TERMINAL:
        return {"status": run.status}
    if run.phase == "publishing":  # The control plane owns the run now.
        return {"status": run.status}
    changed = run.phase != body.phase[:40]
    run.phase, run.heartbeat_at = body.phase[:40], dt.datetime.now(dt.UTC)
    if changed:
        await _announce(session, run.project_id)
    return {"status": run.status}


@router.post("/internal/runs/{run_id}/tests", include_in_schema=False)
async def run_tests_report(
    run_id: uuid.UUID,
    body: SuiteReport,
    session: Session,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """One test suite started or finished; the Developer station shows it live."""
    run = await _run_for_worker(session, run_id, authorization)
    if run.status in TERMINAL:
        return {"status": run.status}
    run.test_suites = test_suites.merge(list(run.test_suites or []), body)
    run.heartbeat_at = dt.datetime.now(dt.UTC)
    await _announce(session, run.project_id)
    return {"status": run.status, "suites": run.test_suites}


async def _review_in_control_plane(body: RunResult, title: str) -> RunResult:
    """Adds an AI review to a result that arrived without one.

    A failed review leaves ``reviewed`` false, which blocks the merge until
    someone re-runs it.
    """
    try:
        review = await review_engine.review_diff(body.patch or "", title=title)
    except Exception:
        logger.warning("Control-plane review failed", exc_info=True)
        return body
    return body.model_copy(
        update={
            "review": list(review.comments),
            "reviewed": True,
            "review_engine": review.engine,
            "review_model": review.model,
            "review_summary": review.summary,
        }
    )


@router.post("/internal/runs/{run_id}/complete", include_in_schema=False)
async def run_complete(
    run_id: uuid.UUID,
    body: RunResult,
    session: Session,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    """Final report from the worker, then publish from the control plane.

    Idempotent: a late or duplicate callback cannot revive a finished run or
    publish twice. Publishing (clone, push, PR) happens without holding the
    project lock, guarded by a one-shot ``phase='publishing'`` claim.
    """
    run = await _run_for_worker(session, run_id, authorization)
    if run.status in TERMINAL:
        return {"status": run.status, "note": "already final"}
    # The final word on each suite, for runners that report only at the end.
    for report in body.test_suites:
        run.test_suites = test_suites.merge(list(run.test_suites or []), report)
    if not body.ok or not body.patch:
        await _finish_failed(
            session, run, "failed", body.error or "worker reported failure", body
        )
        await _announce(session, run.project_id)
        return {"status": run.status}

    claimed = await session.execute(
        update(Run)
        .where(
            Run.id == run.id,
            Run.status == "running",
            Run.phase.is_distinct_from("publishing"),
        )
        .values(phase="publishing", heartbeat_at=dt.datetime.now(dt.UTC))
    )
    if claimed.rowcount != 1:
        return {"status": run.status, "note": "already publishing"}
    await session.commit()

    task = await get_or_404(session, Task, run.task_id)
    project = await get_or_404(session, Project, run.project_id)
    tests_passed = body.test_exit_code == 0
    if not body.reviewed:
        # Runners on developer machines hold no review engine; review here.
        body = await _review_in_control_plane(body, task.title)
    # Anchor every comment to a line that exists in the diff, so GitHub accepts
    # the inline threads and the UI can render them under the right line.
    anchored_review = anchor_comments(body.patch, list(body.review))
    review_md = (
        github.review_markdown(
            [c.model_dump() for c in anchored_review],
            engine=body.review_engine or "",
            summary=body.review_summary or "",
        )
        if body.reviewed
        else None
    )
    try:
        published = await publisher.publish(
            run_id=run.id,
            task_key=task.key,
            task_title=task.title,
            patch=body.patch,
            pr_body=publisher.pr_body(
                task_key=task.key,
                task_title=task.title,
                project_name=project.name,
                run_id=run.id,
                criteria=task.acceptance_criteria,
                test_command=body.test_command or "",
                exit_code=body.test_exit_code
                if body.test_exit_code is not None
                else -1,
                output=body.test_output or "",
            ),
            tests_passed=tests_passed,
            test_summary=f"pytest exit {body.test_exit_code} (Karkhana worker)",
            review_markdown=review_md,
            review_comments=(
                [c.model_dump() for c in anchored_review] if body.reviewed else None
            ),
            review_engine=body.review_engine or "",
            review_summary=body.review_summary or "",
            target=await repos.for_project(session, project.id),
            token=await repos.write_token(session, project.id, run.requested_by),
        )
    except Exception as exc:
        logger.exception("Publishing run %s failed", run.id)
        await session.refresh(run)
        await _finish_failed(session, run, "failed", f"publish failed: {exc}", body)
        await _announce(session, run.project_id)
        return {"status": run.status}

    await session.refresh(run)
    project = await lock_project(session, run.project_id)
    now = dt.datetime.now(dt.UTC)
    run.status, run.phase, run.finished_at, run.heartbeat_at = (
        "succeeded",
        "done",
        now,
        now,
    )
    run.validation_status = "passed" if tests_passed else "failed"
    run.branch, run.patch, run.test_command = (
        published.branch,
        body.patch[:200_000],
        body.test_command,
    )
    run.test_exit_code, run.test_output, run.artifacts_uri = (
        body.test_exit_code,
        body.test_output,
        body.artifacts_uri,
    )
    run.context_compression = body.context_compression
    await ledger.append(
        session,
        actor=CODER,
        action="run.completed",
        subject_type="run",
        subject_id=run.id,
        project_id=project.id,
        payload={
            "task": task.key,
            "branch": published.branch,
            "test_command": body.test_command,
            "test_exit_code": body.test_exit_code,
            "validation": run.validation_status,
            "patch_sha256": hashlib.sha256(body.patch.encode()).hexdigest(),
        },
    )
    if body.summary:
        session.add(
            ContextEntry(
                id=uuid.uuid4(),
                project_id=project.id,
                kind="handoff",
                title=f"{task.key}: {task.title}"[:140],
                body=body.summary[:4000],
                author_label=CODER.label,
                author_kind="ai",
                run_id=run.id,
            )
        )
    pr = PullRequest(
        id=uuid.uuid4(),
        task_id=task.id,
        run_id=run.id,
        number=published.pr_number,
        url=published.pr_url,
        branch=published.branch,
        head_sha=published.head_sha,
        tests_passed=tests_passed,
    )
    session.add(pr)
    await plan.move_task(session, task, "review")
    await session.flush()
    await ledger.append(
        session,
        actor=ledger.SYSTEM,
        action="pr.opened",
        subject_type="pull_request",
        subject_id=pr.id,
        project_id=project.id,
        payload={
            "number": pr.number,
            "url": pr.url,
            "tests_passed": tests_passed,
            "draft": published.draft,
            "published_by": "control-plane",
        },
    )
    await advance_if_legal(
        session, project, Event.PR_OPENED, actor=CODER, payload={"pr": pr.number}
    )

    for c in anchored_review:
        session.add(
            ReviewComment(
                pr_id=pr.id, path=c.path, line=c.line, severity=c.severity, body=c.body
            )
        )
    await session.flush()
    if body.reviewed:
        pr.reviewed_at = dt.datetime.now(dt.UTC)
        pr.review_engine, pr.review_model = body.review_engine, body.review_model
        pr.review_summary = body.review_summary
        await ledger.append(
            session,
            actor=REVIEWER,
            action="review.posted",
            subject_type="pull_request",
            subject_id=pr.id,
            project_id=project.id,
            payload={
                "comments": len(body.review),
                "engine": body.review_engine,
                "model": body.review_model,
                "label": "AI-generated, unverified",
            },
        )
        await advance_if_legal(
            session,
            project,
            Event.REVIEW_POSTED,
            actor=REVIEWER,
            payload={"pr": pr.number},
        )
    await _announce(session, project.id)
    return {"status": run.status, "validation": run.validation_status}


async def _finish_failed(
    session: AsyncSession,
    run: Run,
    state: str,
    error: str,
    body: RunResult | None = None,
) -> None:
    task = await get_or_404(session, Task, run.task_id)
    project = await lock_project(session, run.project_id)
    run.status, run.error, run.finished_at = (
        state,
        error[:2000],
        dt.datetime.now(dt.UTC),
    )
    if body and body.test_exit_code is not None:
        run.validation_status = "passed" if body.test_exit_code == 0 else "failed"
    if body:
        run.test_exit_code, run.test_output, run.test_command = (
            body.test_exit_code,
            body.test_output,
            body.test_command,
        )
        run.context_compression = body.context_compression
    if task.status == "in_progress":
        await plan.move_task(session, task, "ready")
    await advance_if_legal(session, project, Event.RUN_FAILED, actor=ledger.SYSTEM)
    await ledger.append(
        session,
        actor=ledger.SYSTEM,
        action=f"run.{state}",
        subject_type="run",
        subject_id=run.id,
        project_id=project.id,
        payload={"task": task.key, "error": error[:300]},
    )
