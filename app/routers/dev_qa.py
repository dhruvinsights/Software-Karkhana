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

"""The developer's side of accountability, and the board the Developer station reads.

Endpoints:
  GET  /api/projects/{id}/dev-board   — stories with run, suites, PR, reviewers,
                                        manual check and bugs; the project's bugs
  POST /api/issues/{id}/dev-check     — the developer's manual check of a story
  POST /api/issues/{id}/start-fix     — a developer takes a QA bug
  POST /api/issues/{id}/mark-fixed    — fixed, with a manual check of the fix
  POST /api/issues/{id}/verify        — QA verifies the fix, or reopens the bug
  POST /api/prs/{id}/reviewers        — ask project members to review a PR
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, issue_rules, ledger
from app import dev_qa_rules as rules
from app.auth import CurrentUser
from app.config import get_settings
from app.db import get_session
from app.integrations import github_tokens
from app.models import (
    ActivityEvent,
    Issue,
    Project,
    ProjectMember,
    PullRequest,
    ReviewComment,
    Run,
    Task,
    User,
)
from app.notifications import email_people
from app.routers.reviews import _approvals
from app.services import repos
from app.services.realtime import notify_activity, notify_workspace

logger = logging.getLogger(__name__)
router = APIRouter(tags=["dev-qa"])
Session = Annotated[AsyncSession, Depends(get_session)]


async def _issue(session: AsyncSession, issue_id: uuid.UUID) -> Issue:
    issue = await session.scalar(
        select(Issue).where(Issue.id == issue_id).with_for_update()
    )
    if issue is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Issue not found.")
    return issue


async def _station(
    session: AsyncSession, user: Any, project_id: uuid.UUID, station: str
) -> Project:
    project = await access.get_visible_project(session, user, project_id)
    await access.ensure_station(session, user, project, station)
    return project


async def _tell(
    session: AsyncSession,
    project: Project,
    actor: User,
    recipients: set[uuid.UUID | None],
    *,
    kind: str,
    summary: str,
    issue: Issue,
    email_subject: str | None = None,
    email_lines: list[str] | None = None,
) -> None:
    """In-app notice (and optionally an email) to ``recipients``, never to the actor."""
    people = {r for r in recipients if r and r != actor.id}
    if not people or project.workspace_id is None:
        return
    for rid in people:
        session.add(
            ActivityEvent(
                workspace_id=project.workspace_id,
                actor_id=actor.id,
                recipient_id=rid,
                type=kind,
                summary=summary,
                target_type="issue",
                target_id=str(issue.id),
                project_id=project.id,
            )
        )
    await session.commit()
    await notify_activity(project.workspace_id, people)
    if email_subject:
        await email_people(
            session,
            people,
            subject=email_subject,
            heading=summary,
            lines=email_lines or [],
        )


def _check_record(
    user: User, criteria: list[dict[str, Any]], notes: str, kind: str
) -> dict[str, Any]:
    return {
        "kind": kind,
        "by": str(user.id),
        "byName": user.display_name,
        "at": dt.datetime.now(dt.UTC).isoformat(),
        "criteria": [
            {"text": str(c.get("text", ""))[:500], "ok": c.get("ok") is True}
            for c in criteria
        ][:30],
        "notes": notes.strip()[:4000],
    }


# ── Manual checks and the bug lifecycle ──────────────────────────────────────


class CheckIn(BaseModel):
    """What the developer tried by hand."""

    criteria: list[dict[str, Any]] = Field(default_factory=list, max_length=30)
    notes: str = Field(default="", max_length=4000)


@router.post("/api/issues/{issue_id}/dev-check")
async def dev_check(
    issue_id: uuid.UUID, body: CheckIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """The developer confirms they ran the finished story by hand, criterion by criterion."""
    issue = await _issue(session, issue_id)
    if issue.type != "story":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Manual checks are for stories; use mark-fixed for bugs.",
        )
    project = await _station(session, user, issue.project_id, "developer")
    if not rules.story_check_allowed(issue.status):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{issue_rules.key(issue.number)} is {issue.status.replace('_', ' ')}; check it once its code is written.",
        )
    problem = rules.check_problem(
        list(issue.acceptance_criteria or []), body.criteria, body.notes
    )
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, problem)
    issue.dev_check = _check_record(user, body.criteria, body.notes, "story")
    issue.updated_at = dt.datetime.now(dt.UTC)
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="dev.manual_check",
        subject_type="issue",
        subject_id=issue.id,
        project_id=project.id,
        payload={"key": issue_rules.key(issue.number), "criteria": len(body.criteria)},
    )
    await session.commit()
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "projects")
    return {"id": str(issue.id), "devCheck": issue.dev_check}


def _require_bug(issue: Issue) -> None:
    if issue.type != "bug":
        raise HTTPException(status.HTTP_409_CONFLICT, "This is not a bug.")


@router.post("/api/issues/{issue_id}/start-fix")
async def start_fix(
    issue_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """A developer takes the bug (it becomes theirs if nobody had it)."""
    issue = await _issue(session, issue_id)
    _require_bug(issue)
    project = await _station(session, user, issue.project_id, "developer")
    if rules.bug_state(issue.status, issue.reopen_count) not in ("new", "reopened"):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Only a new or reopened bug can be started."
        )
    issue.status = "in_progress"
    issue.assignee_id = issue.assignee_id or user.id
    issue.updated_at = dt.datetime.now(dt.UTC)
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="bug.fix_started",
        subject_type="issue",
        subject_id=issue.id,
        project_id=project.id,
        payload={"key": issue_rules.key(issue.number)},
    )
    await session.commit()
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "projects")
    return {
        "id": str(issue.id),
        "status": issue.status,
        "state": rules.bug_state(issue.status, issue.reopen_count),
    }


@router.post("/api/issues/{issue_id}/mark-fixed")
async def mark_fixed(
    issue_id: uuid.UUID, body: CheckIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """The developer says it is fixed, and how they confirmed it by hand. QA verifies next."""
    issue = await _issue(session, issue_id)
    _require_bug(issue)
    project = await _station(session, user, issue.project_id, "developer")
    if not rules.fix_allowed(issue.status):
        raise HTTPException(status.HTTP_409_CONFLICT, "This bug is not open for a fix.")
    problem = rules.check_problem([], body.criteria, body.notes)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, problem)
    issue.dev_check = _check_record(user, body.criteria, body.notes, "fix")
    issue.status = "ready_for_qa"
    issue.assignee_id = issue.assignee_id or user.id
    issue.updated_at = dt.datetime.now(dt.UTC)
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="bug.marked_fixed",
        subject_type="issue",
        subject_id=issue.id,
        project_id=project.id,
        payload={
            "key": issue_rules.key(issue.number),
            "notes": issue.dev_check["notes"][:200],
        },
    )
    await session.commit()
    await _tell(
        session,
        project,
        user,
        {issue.reporter_id},
        kind="bug_fixed",
        summary=f'{user.display_name} fixed {issue_rules.key(issue.number)} "{issue.title}"; please verify',
        issue=issue,
        email_subject=f"Verify fix: {issue.title}",
        email_lines=[f"How it was checked: {issue.dev_check['notes']}"],
    )
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "projects")
    return {
        "id": str(issue.id),
        "status": issue.status,
        "state": "fixed",
        "devCheck": issue.dev_check,
    }


class VerifyIn(BaseModel):
    """QA's verdict on a fix."""

    result: Literal["pass", "fail"]
    notes: str = Field(default="", max_length=4000)


@router.post("/api/issues/{issue_id}/verify")
async def verify_fix(
    issue_id: uuid.UUID, body: VerifyIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """QA confirms the fix (the bug closes) or reopens it back to the developer."""
    issue = await _issue(session, issue_id)
    _require_bug(issue)
    project = await _station(session, user, issue.project_id, "qa")
    if not rules.verify_allowed(issue.status):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only a bug the developer marked fixed can be verified.",
        )
    if body.result == "fail" and len(body.notes.strip()) < rules.MIN_NOTES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Say what still fails, so the developer can fix it.",
        )
    now = dt.datetime.now(dt.UTC)
    if body.result == "pass":
        issue.status, issue.closed_at = "done", now
    else:
        issue.status, issue.closed_at = "backlog", None
        issue.reopen_count = (issue.reopen_count or 0) + 1
        issue.labels = sorted({*(issue.labels or []), "reopened"})
    issue.updated_at = now
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="bug.verified" if body.result == "pass" else "bug.reopened",
        subject_type="issue",
        subject_id=issue.id,
        project_id=project.id,
        payload={"key": issue_rules.key(issue.number), "notes": body.notes[:300]},
    )
    await session.commit()
    if body.result == "fail":
        await _tell(
            session,
            project,
            user,
            {issue.assignee_id},
            kind="bug_reopened",
            summary=f'{user.display_name} reopened {issue_rules.key(issue.number)} "{issue.title}"',
            issue=issue,
            email_subject=f"Reopened: {issue.title}",
            email_lines=[f"What still fails: {body.notes.strip()}"],
        )
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "projects")
    return {
        "id": str(issue.id),
        "status": issue.status,
        "state": rules.bug_state(issue.status, issue.reopen_count),
    }


# ── Reviewers ─────────────────────────────────────────────────────────────────


class ReviewersIn(BaseModel):
    """Project members to ask for a review."""

    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=10)


async def _github_login(session: AsyncSession, user_id: uuid.UUID) -> str | None:
    """The reviewer's GitHub login, when they connected GitHub."""
    token = await github_tokens.load_token(session, user_id)
    if not token:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            r = await http.get(
                f"{get_settings().github_api_url}/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "User-Agent": "software-karkhana",
                },
            )
        return r.json().get("login") if r.status_code == 200 else None
    except httpx.HTTPError:
        return None


@router.post("/api/prs/{pr_id}/reviewers")
async def request_reviewers(
    pr_id: uuid.UUID, body: ReviewersIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Asks project members to review: in-app, email, and on GitHub when their login is known."""
    pr = await session.get(PullRequest, pr_id)
    if pr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pull request not found.")
    task = await session.get(Task, pr.task_id)
    assert task is not None
    project = await _station(session, user, task.project_id, "developer")
    run = await session.get(Run, pr.run_id) if pr.run_id else None
    author = run.requested_by if run else None
    wanted = list(dict.fromkeys(body.user_ids))
    if author in wanted:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "The author cannot review their own change.",
        )
    members = set(
        (
            await session.scalars(
                select(ProjectMember.user_id).where(
                    ProjectMember.project_id == project.id,
                    ProjectMember.user_id.in_(wanted),
                )
            )
        ).all()
    )
    outside = [str(u) for u in wanted if u not in members]
    if outside:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Not members of this project: " + ", ".join(outside),
        )
    people = {
        u.id: u
        for u in (await session.scalars(select(User).where(User.id.in_(wanted)))).all()
    }
    now = dt.datetime.now(dt.UTC).isoformat()
    current = {r["userId"]: r for r in (pr.requested_reviewers or [])}
    for uid in wanted:
        current[str(uid)] = {
            "userId": str(uid),
            "name": people[uid].display_name,
            "by": str(user.id),
            "at": now,
        }
    pr.requested_reviewers = list(current.values())
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="pr.reviewers_requested",
        subject_type="pull_request",
        subject_id=pr.id,
        project_id=project.id,
        payload={
            "reviewers": [people[u].display_name for u in wanted],
            "number": pr.number,
        },
    )
    await session.commit()

    # GitHub: best effort, with the token that writes for this project.
    logins = [login for u in wanted if (login := await _github_login(session, u))]
    on_github = False
    if logins and not pr.url.startswith("local://"):
        gh = await repos.client_for(session, project.id, user.id)
        if gh is not None:
            try:
                await gh.request_reviewers(number=pr.number, reviewers=logins)
                on_github = True
            except (
                Exception
            ):  # GitHub refusing a reviewer must not undo the request here
                logger.warning(
                    "GitHub reviewer request failed for PR %s", pr.number, exc_info=True
                )
            finally:
                await gh.aclose()

    story = await session.scalar(
        select(Issue).where(Issue.task_id == task.id, Issue.type == "story")
    )
    if story is not None:
        await _tell(
            session,
            project,
            user,
            set(wanted),
            kind="review_requested",
            summary=f'{user.display_name} asked you to review PR #{pr.number} for {task.key} "{task.title}"',
            issue=story,
            email_subject=f"Review requested: {task.title}",
            email_lines=[f"Pull request: {pr.url}"],
        )
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "projects")
    return {"requestedReviewers": pr.requested_reviewers, "onGitHub": on_github}


# ── Board ─────────────────────────────────────────────────────────────────────


def _iso(v: dt.datetime | None) -> str | None:
    return v.isoformat() if v else None


def _bug_out(
    b: Issue, names: dict[uuid.UUID, str], parent_keys: dict[uuid.UUID, str]
) -> dict[str, Any]:
    return {
        "id": str(b.id),
        "key": issue_rules.key(b.number),
        "title": b.title,
        "description": b.description,
        "priority": b.priority,
        "status": b.status,
        "state": rules.bug_state(b.status, b.reopen_count or 0),
        "reopenCount": b.reopen_count or 0,
        "source": b.source,
        "storyId": str(b.parent_id) if b.parent_id else None,
        "storyKey": parent_keys.get(b.parent_id) if b.parent_id else None,
        "assigneeId": str(b.assignee_id) if b.assignee_id else None,
        "assigneeName": names.get(b.assignee_id) if b.assignee_id else None,
        "reporterName": names.get(b.reporter_id),
        "devCheck": b.dev_check,
        "createdAt": _iso(b.created_at),
        "updatedAt": _iso(b.updated_at),
    }


@router.get("/api/projects/{project_id}/dev-board")
async def dev_board(
    project_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Everything the Developer station shows, in one read."""
    project = await access.get_visible_project(session, user, project_id)
    issues = list(
        (
            await session.scalars(
                select(Issue)
                .where(
                    Issue.project_id == project.id,
                    Issue.type.in_(("story", "bug")),
                    Issue.status != "draft",
                )
                .order_by(Issue.number)
            )
        ).all()
    )
    stories = [i for i in issues if i.type == "story"]
    bugs = [i for i in issues if i.type == "bug"]
    user_ids = {i.assignee_id for i in issues} | {i.reporter_id for i in issues}
    names = {
        u.id: u.display_name
        for u in (
            await session.scalars(
                select(User).where(User.id.in_([x for x in user_ids if x]))
            )
        ).all()
    }
    keys = {s.id: issue_rules.key(s.number) for s in stories}

    task_ids = [s.task_id for s in stories if s.task_id]
    latest_run: dict[uuid.UUID, Run] = {}
    for r in (
        await session.scalars(
            select(Run).where(Run.task_id.in_(task_ids)).order_by(Run.created_at.desc())
        )
    ).all():
        latest_run.setdefault(r.task_id, r)
    latest_pr: dict[uuid.UUID, PullRequest] = {}
    for p in (
        await session.scalars(
            select(PullRequest)
            .where(PullRequest.task_id.in_(task_ids))
            .order_by(PullRequest.number.desc())
        )
    ).all():
        latest_pr.setdefault(p.task_id, p)
    open_comments: dict[uuid.UUID, int] = {}
    if latest_pr:
        for c in (
            await session.scalars(
                select(ReviewComment).where(
                    ReviewComment.pr_id.in_([p.id for p in latest_pr.values()]),
                    ReviewComment.triage == "open",
                )
            )
        ).all():
            open_comments[c.pr_id] = open_comments.get(c.pr_id, 0) + 1

    out_stories = []
    for s in stories:
        run = latest_run.get(s.task_id) if s.task_id else None
        pr = latest_pr.get(s.task_id) if s.task_id else None
        approvals = await _approvals(session, pr) if pr else []
        approver_names = (
            {
                u.id: u.display_name
                for u in (
                    await session.scalars(
                        select(User).where(
                            User.id.in_([a.decided_by for a in approvals])
                        )
                    )
                ).all()
            }
            if approvals
            else {}
        )
        out_stories.append(
            {
                "id": str(s.id),
                "key": keys[s.id],
                "title": s.title,
                "status": s.status,
                "layer": rules.layer_of(s.labels, s.description),
                "taskId": str(s.task_id) if s.task_id else None,
                "assigneeId": str(s.assignee_id) if s.assignee_id else None,
                "assigneeName": names.get(s.assignee_id) if s.assignee_id else None,
                "acceptanceCriteria": s.acceptance_criteria or [],
                "devCheck": s.dev_check,
                "run": {
                    "id": str(run.id),
                    "status": run.status,
                    "phase": run.phase,
                    "branch": run.branch,
                    "error": run.error,
                    "testSuites": run.test_suites or [],
                    "testExitCode": run.test_exit_code,
                    "createdAt": _iso(run.created_at),
                    "finishedAt": _iso(run.finished_at),
                }
                if run
                else None,
                "pr": {
                    "id": str(pr.id),
                    "number": pr.number,
                    "url": pr.url,
                    "status": pr.status,
                    "testsPassed": pr.tests_passed,
                    "reviewed": pr.reviewed_at is not None,
                    "openComments": open_comments.get(pr.id, 0),
                    "approvals": [
                        approver_names.get(a.decided_by, "") for a in approvals
                    ],
                    "requestedReviewers": pr.requested_reviewers or [],
                }
                if pr
                else None,
                "bugs": [_bug_out(b, names, keys) for b in bugs if b.parent_id == s.id],
            }
        )
    return {
        "projectId": str(project.id),
        "stories": out_stories,
        "bugs": [_bug_out(b, names, keys) for b in bugs],
    }
