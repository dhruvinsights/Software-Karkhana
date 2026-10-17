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

"""Pull requests, mandatory triage and merge (A9, A10) plus learning capture (B1)."""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, agent_memory, ledger, memory
from app.auth import CurrentUser
from app.db import get_session
from app.integrations import github
from app.models import Approval, Project, PullRequest, ReviewComment, Run, Task, User
from app.process import Event, Role
from app.review.diff import anchor_comments, diff_to_json, parse_unified_diff
from app.routers.common import advance_if_legal, get_or_404, lock_project
from app.schemas import (
    CommentOut,
    LearningOut,
    PrApprovalOut,
    PrApproveIn,
    PullRequestOut,
    TriageIn,
)
from app.services import pipelines, plan, repos
from app.services.realtime import notify_workspace

router = APIRouter(prefix="/api", tags=["reviews"])
Session = Annotated[AsyncSession, Depends(get_session)]
# Authority is checked per project in ``_guard_task`` (workspace role + station).
logger = logging.getLogger(__name__)
Dev = CurrentUser
AnyRole = CurrentUser
DEV_ROLES = (Role.DEVELOPER, Role.LEAD)


def merge_blockers(
    pr: PullRequest,
    comments: list[ReviewComment],
    approvers: list[uuid.UUID] | None = None,
    author: uuid.UUID | None = None,
) -> list[str]:
    """Everything recorded in Karkhana that must be true before merge.

    Empty means mergeable here; GitHub's own checks are verified at merge time.
    ``approvers`` are people who approved the PR; one must not be its ``author``.
    """
    blockers = []
    if pr.status != "open":
        blockers.append(f"PR is {pr.status}")
    if not pr.tests_passed:
        blockers.append("Tests failed in the worker run")
    if pr.reviewed_at is None:
        blockers.append("No AI review recorded")
    open_count = sum(1 for c in comments if c.triage == "open")
    if open_count:
        blockers.append(f"{open_count} AI comment(s) not triaged")
    if approvers is not None and not any(a != author for a in approvers):
        blockers.append("Needs approval from a reviewer other than the author")
    return blockers


def _gate(pr: PullRequest) -> str:
    return f"pr:{pr.id}"


async def _approvals(session: AsyncSession, pr: PullRequest) -> list[Approval]:
    return list(
        (
            await session.scalars(
                select(Approval)
                .where(Approval.gate == _gate(pr), Approval.decision == "approved")
                .order_by(Approval.decided_at)
            )
        ).all()
    )


async def _author(session: AsyncSession, pr: PullRequest) -> uuid.UUID | None:
    """Who asked for the change: the requester of the run that produced it."""
    run = await session.get(Run, pr.run_id) if pr.run_id else None
    return run.requested_by if run else None




async def _pr_out(session: AsyncSession, pr: PullRequest) -> PullRequestOut:
    rank = {"high": 0, "medium": 1, "low": 2}
    comments = sorted(
        (
            await session.scalars(
                select(ReviewComment).where(ReviewComment.pr_id == pr.id)
            )
        ).all(),
        key=lambda c: (rank.get(c.severity, 3), c.path),
    )
    approvals = await _approvals(session, pr)
    author = await _author(session, pr)
    blockers = merge_blockers(pr, comments, [a.decided_by for a in approvals], author)
    names = {
        u.id: u.display_name
        for u in (await session.scalars(select(User).where(User.id.in_([a.decided_by for a in approvals])))).all()
    }
    out = PullRequestOut.model_validate(pr)
    out.comments = [CommentOut.model_validate(c) for c in comments]
    out.approvals = [
        PrApprovalOut(by=names.get(a.decided_by, ""), note=a.reason, at=a.decided_at) for a in approvals
    ]
    out.merge_blockers, out.can_merge = blockers, not blockers
    return out


async def _guard_task(
    session: AsyncSession, user: User, task_id: uuid.UUID, *roles: str
) -> None:
    """Only people on the developer or QA station of the task's project reach its PRs.

    With ``roles``, the caller must also hold one of them in the project's
    workspace (for example developer/lead to triage or merge).
    """
    task = await get_or_404(session, Task, task_id)
    project = await get_or_404(session, Project, task.project_id)
    if roles:
        await access.require_project_role(session, user, project, *roles)
    await access.ensure_station(session, user, project, "developer", "qa")


@router.get("/tasks/{task_id}/pr", response_model=PullRequestOut | None)
async def task_pr(
    task_id: uuid.UUID, session: Session, user: AnyRole
) -> PullRequestOut | None:
    """The latest PR for a task, with comments and merge readiness."""
    await _guard_task(session, user, task_id)
    pr = await session.scalar(
        select(PullRequest)
        .where(PullRequest.task_id == task_id)
        .order_by(PullRequest.number.desc())
        .limit(1)
    )
    return await _pr_out(session, pr) if pr else None


@router.post("/comments/{comment_id}/triage", response_model=CommentOut)
async def triage(
    comment_id: uuid.UUID, body: TriageIn, session: Session, user: Dev
) -> ReviewComment:
    """Developer marks an AI comment Valid or Dismissed (a reason is required to dismiss)."""
    comment = await get_or_404(session, ReviewComment, comment_id)
    pr = await get_or_404(session, PullRequest, comment.pr_id)
    await _guard_task(session, user, pr.task_id, *DEV_ROLES)
    if pr.status != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, "PR is no longer open")
    reason = (body.reason or "").strip() or None
    if body.triage == "dismissed" and not reason:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "A reason is required to dismiss a comment",
        )
    comment.triage, comment.triage_reason = body.triage, reason
    comment.triaged_by, comment.triaged_at = user.id, dt.datetime.now(dt.UTC)
    task = await get_or_404(session, Task, pr.task_id)
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action=f"comment.{body.triage}",
        subject_type="review_comment",
        subject_id=comment.id,
        project_id=task.project_id,
        payload={"pr": pr.number, "severity": comment.severity, "reason": reason},
    )
    return comment


@router.post("/prs/{pr_id}/approve", response_model=PullRequestOut)
async def approve_pr(
    pr_id: uuid.UUID, body: PrApproveIn, session: Session, user: Dev
) -> PullRequestOut:
    """A reviewer other than the author approves the change (human review gate)."""
    pr = await get_or_404(session, PullRequest, pr_id)
    task = await get_or_404(session, Task, pr.task_id)
    project = await get_or_404(session, Project, task.project_id)
    await access.require_project_role(session, user, project, Role.DEVELOPER, Role.LEAD, Role.ARCHITECT)
    await access.ensure_station(session, user, project, "developer", "architecture")
    if pr.status != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, f"PR is {pr.status}")
    if user.id == await _author(session, pr):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot approve your own change.")
    if any(a.decided_by == user.id for a in await _approvals(session, pr)):
        raise HTTPException(status.HTTP_409_CONFLICT, "You already approved this PR.")
    note = (body.note or "").strip() or None
    session.add(
        Approval(project_id=project.id, gate=_gate(pr), decision="approved", reason=note, decided_by=user.id)
    )
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="pr.approved",
        subject_type="pull_request",
        subject_id=pr.id,
        project_id=project.id,
        payload={"number": pr.number, "note": note},
    )
    await session.flush()
    if not pr.url.startswith("local://") and (gh := await repos.client_for(session, project.id, user.id)):
        try:
            await gh.post_review(
                number=pr.number,
                body=f"✅ Approved in Software Karkhana by **{user.display_name}**" + (f": {note}" if note else "."),
            )
        except Exception:
            logger.warning("Could not post the approval to PR %s", pr.number, exc_info=True)
        finally:
            await gh.aclose()
    await session.commit()
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "runs")
    return await _pr_out(session, pr)


@router.post("/prs/{pr_id}/merge", response_model=LearningOut)
async def merge(pr_id: uuid.UUID, session: Session, user: Dev):
    """Merges on GitHub only when every blocker is cleared, then captures a learning."""
    pr = await get_or_404(session, PullRequest, pr_id)
    await _guard_task(session, user, pr.task_id, *DEV_ROLES)
    comments = list(
        (
            await session.scalars(
                select(ReviewComment).where(ReviewComment.pr_id == pr.id)
            )
        ).all()
    )
    approvals = await _approvals(session, pr)
    blockers = merge_blockers(
        pr, comments, [a.decided_by for a in approvals], await _author(session, pr)
    )
    if blockers:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Cannot merge: " + "; ".join(blockers)
        )
    task = await get_or_404(session, Task, pr.task_id)
    project = await lock_project(session, task.project_id)
    actor = ledger.Actor.human(user)

    merge_sha = ""
    if not pr.url.startswith("local://"):
        gh = await repos.client_for(session, task.project_id, user.id)
        if gh is None:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "GitHub is not configured"
            )
        try:
            remote = await gh.get_pull_request(number=pr.number)
            if remote.get("merged"):
                # Merged on GitHub already (a retry after a failure here): record it.
                merge_sha = remote.get("merge_commit_sha") or ""
            else:
                failing = await pipelines.ci_blockers(gh, pr.head_sha)
                if failing:
                    raise HTTPException(
                        status.HTTP_409_CONFLICT, "Cannot merge: CI is not green: " + "; ".join(failing)
                    )
                merge_sha = await gh.merge(
                    number=pr.number, title=f"{task.key}: {task.title}"
                )
        finally:
            await gh.aclose()

    pr.status, pr.merged_by, pr.merged_at = "merged", user.id, dt.datetime.now(dt.UTC)
    await plan.move_task(session, task, "done")
    await ledger.append(
        session,
        actor=actor,
        action="pr.merged",
        subject_type="pull_request",
        subject_id=pr.id,
        project_id=project.id,
        payload={
            "number": pr.number,
            "merge_sha": merge_sha,
            "valid": sum(c.triage == "valid" for c in comments),
            "dismissed": sum(c.triage == "dismissed" for c in comments),
        },
    )
    others_open = await session.scalar(
        select(func.count())
        .select_from(PullRequest)
        .join(Task, Task.id == PullRequest.task_id)
        .where(
            Task.project_id == project.id,
            PullRequest.status == "open",
            PullRequest.id != pr.id,
        )
    )
    if project.stage == "review" and not others_open:
        await advance_if_legal(
            session, project, Event.MERGED, actor=actor, payload={"pr": pr.number}
        )
    # GitHub has merged: record that before the slower, optional learning step.
    await session.commit()
    learning = await memory.capture_on_merge(
        session, pr=pr, task=task, actor=ledger.Actor.ai("memory-curator")
    )
    for role in ("developer", "reviewer"):
        await agent_memory.remember(
            project.id, role, f"{task.title}: {learning.text}"
        )
    await session.commit()
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "runs")
    return learning


@router.post("/prs/{pr_id}/review", response_model=PullRequestOut)
async def rerun_review(pr_id: uuid.UUID, session: Session, user: Dev) -> PullRequestOut:
    """Retries the AI review when the worker could not record one.

    Without this, a reviewer outage would leave the PR permanently blocked by
    "No AI review recorded".
    """
    from app.review import engine as review_engine

    # Row lock for the whole retry: a concurrent retry waits here, then sees
    # the comments this one wrote and gets 409. No duplicate reviews.
    pr = await session.scalar(
        select(PullRequest).where(PullRequest.id == pr_id).with_for_update()
    )
    if pr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "PullRequest not found")
    await _guard_task(session, user, pr.task_id, *DEV_ROLES)
    if pr.status != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, "PR is not open")
    if pr.reviewed_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This PR already has an AI review"
        )
    run = await get_or_404(session, Run, pr.run_id)
    task = await get_or_404(session, Task, pr.task_id)
    try:
        result = await review_engine.review_diff(run.patch or "", title=task.title)
    except Exception as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Reviewer failed: {exc}"
        ) from exc
    comments = anchor_comments(run.patch or "", list(result.comments))
    project = await lock_project(session, task.project_id)
    for c in comments:
        session.add(
            ReviewComment(
                pr_id=pr.id, path=c.path, line=c.line, severity=c.severity, body=c.body
            )
        )
    pr.reviewed_at = dt.datetime.now(dt.UTC)
    pr.review_engine, pr.review_model = result.engine, result.model
    pr.review_summary = result.summary
    await session.flush()
    reviewer = ledger.Actor.ai("reviewer-agent")
    await ledger.append(
        session,
        actor=reviewer,
        action="review.posted",
        subject_type="pull_request",
        subject_id=pr.id,
        project_id=project.id,
        payload={
            "comments": len(comments),
            "retry_by": user.email,
            "engine": result.engine,
            "model": result.model,
            "label": "AI-generated, unverified",
        },
    )
    await advance_if_legal(
        session, project, Event.REVIEW_POSTED, actor=reviewer, payload={"pr": pr.number}
    )
    if not pr.url.startswith("local://") and (gh := await repos.client_for(session, project.id, user.id)) is not None:
        try:
            await gh.post_inline_review(
                number=pr.number,
                head_sha=pr.head_sha,
                comments=[c.model_dump() for c in comments],
                engine=result.engine,
                summary=result.summary,
                diff=run.patch or None,
            )
        except Exception:
            # Fall back to plain comment if inline review fails
            import logging as _log

            _log.getLogger(__name__).warning(
                "Inline review failed for PR %s, falling back to plain comment",
                pr.number,
            )
            try:
                await gh.post_review(
                    number=pr.number,
                    body=github.review_markdown(
                        [c.model_dump() for c in comments],
                        engine=result.engine,
                        summary=result.summary,
                    ),
                )
            except Exception:
                _log.getLogger(__name__).debug(
                    "Plain review comment also failed for PR %s", pr.number, exc_info=True
                )
        finally:
            await gh.aclose()
    return await _pr_out(session, pr)


@router.get("/prs/{pr_id}/diff")
async def pr_diff(pr_id: uuid.UUID, session: Session, user: AnyRole) -> dict[str, Any]:
    """The PR's change as parsed hunks, with each AI comment tied to its line.

    The patch is the one the worker produced and the control plane pushed, so
    what a reviewer sees here is exactly what is on the branch. Comments were
    anchored to real diff lines when stored; any whose file is not in the diff
    come back in ``unplaced`` so the UI can still show and triage them.
    """
    pr = await get_or_404(session, PullRequest, pr_id)
    await _guard_task(session, user, pr.task_id)
    run = await get_or_404(session, Run, pr.run_id)
    files = parse_unified_diff(run.patch or "")
    rows = (
        await session.scalars(select(ReviewComment).where(ReviewComment.pr_id == pr.id))
    ).all()
    rank = {"high": 0, "medium": 1, "low": 2}
    comments = [
        {
            "id": str(c.id),
            "path": c.path,
            "line": c.line,
            "severity": c.severity,
            "body": c.body,
            "triage": c.triage,
            "triage_reason": c.triage_reason,
        }
        for c in sorted(rows, key=lambda c: (rank.get(c.severity, 3), c.line or 0))
    ]
    known = {f.path for f in files}
    return {
        "prId": str(pr.id),
        "number": pr.number,
        "truncated": len(run.patch or "") >= 200_000,
        "additions": sum(f.additions for f in files),
        "deletions": sum(f.deletions for f in files),
        "files": diff_to_json(files),
        "comments": comments,
        "unplaced": [c["id"] for c in comments if c["path"] not in known],
    }
