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
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import ledger, memory, process
from app.auth import require_role
from app.db import get_session
from app.integrations import github
from app.models import PullRequest, ReviewComment, Run, Task, User
from app.process import Event, Role
from app.routers.common import advance_if_legal, get_or_404, lock_project
from app.schemas import CommentOut, LearningOut, PullRequestOut, TriageIn

router = APIRouter(prefix="/api", tags=["reviews"])
Session = Annotated[AsyncSession, Depends(get_session)]
Dev = Annotated[User, Depends(require_role(Role.DEVELOPER, Role.LEAD))]
AnyRole = Annotated[User, Depends(require_role(*Role))]


def merge_blockers(pr: PullRequest, comments: list[ReviewComment]) -> list[str]:
    """Everything that must be true before merge. Empty list means mergeable."""
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
    return blockers


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
    blockers = merge_blockers(pr, comments)
    out = PullRequestOut.model_validate(pr)
    out.comments = [CommentOut.model_validate(c) for c in comments]
    out.merge_blockers, out.can_merge = blockers, not blockers
    return out


@router.get("/tasks/{task_id}/pr", response_model=PullRequestOut | None)
async def task_pr(
    task_id: uuid.UUID, session: Session, _: AnyRole
) -> PullRequestOut | None:
    """The latest PR for a task, with comments and merge readiness."""
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


@router.post("/prs/{pr_id}/merge", response_model=LearningOut)
async def merge(pr_id: uuid.UUID, session: Session, user: Dev):
    """Merges on GitHub only when every blocker is cleared, then captures a learning."""
    pr = await get_or_404(session, PullRequest, pr_id)
    comments = list(
        (
            await session.scalars(
                select(ReviewComment).where(ReviewComment.pr_id == pr.id)
            )
        ).all()
    )
    blockers = merge_blockers(pr, comments)
    if blockers:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Cannot merge: " + "; ".join(blockers)
        )
    task = await get_or_404(session, Task, pr.task_id)
    project = await lock_project(session, task.project_id)
    actor = ledger.Actor.human(user)

    merge_sha = ""
    if not pr.url.startswith("local://"):
        gh = github.client()
        if gh is None:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "GitHub is not configured"
            )
        try:
            merge_sha = await gh.merge(
                number=pr.number, title=f"{task.key}: {task.title}"
            )
        finally:
            await gh.aclose()

    pr.status, pr.merged_by, pr.merged_at = "merged", user.id, dt.datetime.now(dt.UTC)
    process.move_task(task, "done")
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
    return await memory.capture_on_merge(
        session, pr=pr, task=task, actor=ledger.Actor.ai("memory-curator")
    )


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
    comments = result.comments
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
    if not pr.url.startswith("local://") and (gh := github.client()) is not None:
        try:
            await gh.post_inline_review(
                number=pr.number,
                head_sha=pr.head_sha,
                comments=[c.model_dump() for c in comments],
                engine=result.engine,
                summary=result.summary,
            )
        except Exception:
            # Fall back to plain comment if inline review fails
            import logging as _log
            _log.getLogger(__name__).warning(
                "Inline review failed for PR %s, falling back to plain comment", pr.number
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
                pass
        finally:
            await gh.aclose()
    return await _pr_out(session, pr)
