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

"""The QA station: its board, and the QA agent's suggestions a person triages.

Endpoints:
  GET  /api/projects/{id}/qa-board          — stories by QA stage, bugs to verify
  POST /api/issues/{id}/qa-agent            — run the QA agent on a story (suggests only)
  GET  /api/projects/{id}/qa-suggestions    — suggestions, open first
  POST /api/qa-suggestions/{id}/accept      — becomes a bug for the developer
  POST /api/qa-suggestions/{id}/dismiss     — with a reason
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, issue_rules, ledger
from app import dev_qa_rules as rules
from app.auth import CurrentUser
from app.db import get_session
from app.models import Issue, Project, QaSuggestion, TestScenario, User
from app.services import qa_agent, qa_gate
from app.services.realtime import notify_workspace

router = APIRouter(tags=["qa"])
Session = Annotated[AsyncSession, Depends(get_session)]


async def _qa_project(
    session: AsyncSession, user: Any, project_id: uuid.UUID
) -> Project:
    project = await access.get_visible_project(session, user, project_id)
    await access.ensure_station(session, user, project, "qa")
    return project


def _iso(v: dt.datetime | None) -> str | None:
    return v.isoformat() if v else None


def _suggestion_out(
    s: QaSuggestion, keys: dict[uuid.UUID, str], names: dict[uuid.UUID, str]
) -> dict[str, Any]:
    return {
        "id": str(s.id),
        "storyId": str(s.issue_id),
        "storyKey": keys.get(s.issue_id),
        "title": s.title,
        "description": s.description,
        "category": s.category,
        "severity": s.severity,
        "steps": s.steps or [],
        "expected": s.expected,
        "evidence": s.evidence or [],
        "status": s.status,
        "reason": s.reason,
        "bugId": str(s.bug_id) if s.bug_id else None,
        "model": s.model,
        "decidedBy": names.get(s.decided_by) if s.decided_by else None,
        "decidedAt": _iso(s.decided_at),
        "createdAt": _iso(s.created_at),
    }


def stage_of(story: Issue, scenario_states: list[str]) -> str:
    """Where a finished story is in QA."""
    if story.status == "done":
        return "signed_off"
    if not story.dev_check:
        return "waiting_dev_check"
    if story.status == "in_qa" or scenario_states:
        return "in_qa"
    return "ready"


@router.get("/api/projects/{project_id}/qa-board")
async def qa_board(
    project_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Finished stories by QA stage, with scenarios, suggestions and bugs."""
    project = await _qa_project(session, user, project_id)
    stories = list(
        (
            await session.scalars(
                select(Issue)
                .where(
                    Issue.project_id == project.id,
                    Issue.type == "story",
                    Issue.status.in_(("in_review", "ready_for_qa", "in_qa", "done")),
                )
                .order_by(Issue.number)
            )
        ).all()
    )
    ids = [s.id for s in stories]
    scenarios = list(
        (
            await session.scalars(
                select(TestScenario).where(TestScenario.issue_id.in_(ids))
            )
        ).all()
    )
    suggestions = list(
        (
            await session.scalars(
                select(QaSuggestion).where(QaSuggestion.issue_id.in_(ids))
            )
        ).all()
    )
    bugs = list(
        (
            await session.scalars(
                select(Issue)
                .where(Issue.project_id == project.id, Issue.type == "bug")
                .order_by(Issue.number)
            )
        ).all()
    )
    names = {
        u.id: u.display_name
        for u in (
            await session.scalars(
                select(User).where(
                    User.id.in_(
                        [x for b in bugs for x in (b.assignee_id, b.reporter_id) if x]
                    )
                )
            )
        ).all()
    }
    keys = {s.id: issue_rules.key(s.number) for s in stories}
    out = []
    for s in stories:
        if s.status == "in_review" and not s.dev_check:
            continue  # still with the developer
        mine = [t.status for t in scenarios if t.issue_id == s.id]
        counts = {k: mine.count(k) for k in ("passed", "failed", "blocked", "not_run")}
        out.append(
            {
                "id": str(s.id),
                "key": keys[s.id],
                "title": s.title,
                "status": s.status,
                "stage": stage_of(s, [x for x in mine if x != "not_run"]),
                "acceptanceCriteria": s.acceptance_criteria or [],
                "devCheck": s.dev_check,
                "qaAgent": s.qa_agent,
                "scenarios": {"total": len(mine), **counts},
                "openSuggestions": sum(
                    1 for g in suggestions if g.issue_id == s.id and g.status == "open"
                ),
                "bugs": [
                    {
                        "id": str(b.id),
                        "key": issue_rules.key(b.number),
                        "title": b.title,
                        "state": rules.bug_state(b.status, b.reopen_count or 0),
                        "priority": b.priority,
                    }
                    for b in bugs
                    if b.parent_id == s.id
                ],
            }
        )
    return {
        "stories": out,
        "toVerify": [
            {
                "id": str(b.id),
                "key": issue_rules.key(b.number),
                "title": b.title,
                "priority": b.priority,
                "storyKey": keys.get(b.parent_id) if b.parent_id else None,
                "assigneeName": names.get(b.assignee_id) if b.assignee_id else None,
                "devCheck": b.dev_check,
                "reopenCount": b.reopen_count or 0,
            }
            for b in bugs
            if rules.bug_state(b.status, b.reopen_count or 0) == "fixed"
        ],
        "bugs": [
            {
                "id": str(b.id),
                "key": issue_rules.key(b.number),
                "title": b.title,
                "priority": b.priority,
                "state": rules.bug_state(b.status, b.reopen_count or 0),
                "storyKey": keys.get(b.parent_id) if b.parent_id else None,
                "assigneeName": names.get(b.assignee_id) if b.assignee_id else None,
                "reporterName": names.get(b.reporter_id),
                "source": b.source,
            }
            for b in bugs
        ],
    }


@router.post("/api/issues/{issue_id}/qa-agent", status_code=status.HTTP_202_ACCEPTED)
async def start_qa_agent(
    issue_id: uuid.UUID,
    background: BackgroundTasks,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Runs the QA agent on a finished story; it only suggests bugs."""
    story = await session.scalar(
        select(Issue).where(Issue.id == issue_id).with_for_update()
    )
    if story is None or story.type != "story":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Story not found.")
    project = await _qa_project(session, user, story.project_id)
    if story.status not in ("in_review", "ready_for_qa", "in_qa"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The QA agent reviews stories whose code is written.",
        )
    if (story.qa_agent or {}).get("state") == "running":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "The QA agent is already looking at this story."
        )
    story.qa_agent = {
        "state": "running",
        "step": "Starting",
        "by": user.display_name,
        "startedAt": dt.datetime.now(dt.UTC).isoformat(),
    }
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="qa.agent_started",
        subject_type="issue",
        subject_id=story.id,
        project_id=project.id,
        payload={"key": issue_rules.key(story.number)},
    )
    await session.commit()
    background.add_task(qa_agent.run, story.id)
    return {"status": "running"}


@router.get("/api/projects/{project_id}/qa-suggestions")
async def list_suggestions(
    project_id: uuid.UUID,
    session: Session,
    user: CurrentUser,
    status_: Annotated[
        Literal["open", "accepted", "dismissed", "all"], Query(alias="status")
    ] = "all",
) -> list[dict[str, Any]]:
    """The QA agent's suggestions, open ones first."""
    project = await _qa_project(session, user, project_id)
    stmt = select(QaSuggestion).where(QaSuggestion.project_id == project.id)
    if status_ != "all":
        stmt = stmt.where(QaSuggestion.status == status_)
    rows = list(
        (await session.scalars(stmt.order_by(QaSuggestion.created_at.desc()))).all()
    )
    rows.sort(key=lambda s: s.status != "open")
    stories = (
        await session.scalars(
            select(Issue).where(Issue.id.in_({r.issue_id for r in rows}))
        )
    ).all()
    names = {
        u.id: u.display_name
        for u in (
            await session.scalars(
                select(User).where(
                    User.id.in_([r.decided_by for r in rows if r.decided_by])
                )
            )
        ).all()
    }
    keys = {s.id: issue_rules.key(s.number) for s in stories}
    return [_suggestion_out(r, keys, names) for r in rows]


async def _open_suggestion(
    session: AsyncSession, user: Any, suggestion_id: uuid.UUID
) -> tuple[QaSuggestion, Project]:
    s = await session.scalar(
        select(QaSuggestion).where(QaSuggestion.id == suggestion_id).with_for_update()
    )
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Suggestion not found.")
    project = await _qa_project(session, user, s.project_id)
    if s.status != "open":
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"This suggestion was already {s.status}."
        )
    return s, project


class AcceptIn(BaseModel):
    """QA may adjust the priority and add what they saw when confirming."""

    priority: Literal["P0", "P1", "P2", "P3"] | None = None
    notes: str = Field(default="", max_length=4000)


@router.post("/api/qa-suggestions/{suggestion_id}/accept")
async def accept_suggestion(
    suggestion_id: uuid.UUID, body: AcceptIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """QA confirms the suggestion: it becomes a bug assigned to the story's developer."""
    s, project = await _open_suggestion(session, user, suggestion_id)
    story = await session.get(Issue, s.issue_id)
    assert story is not None
    evidence = "\n".join(
        f"- {e.get('path')}{':' + str(e['line']) if e.get('line') else ''} {e.get('note', '')}".rstrip()
        for e in s.evidence or []
    )
    steps = "\n".join(f"{n}. {x}" for n, x in enumerate(s.steps or [], 1))
    bug = await qa_gate.file_bug(
        session,
        story,
        user,
        title=s.title,
        description=(
            f"{s.description}\n\nSteps:\n{steps}\n\nExpected: {s.expected}\n\nWhere:\n{evidence}"
            + (f"\n\nQA notes: {body.notes.strip()}" if body.notes.strip() else "")
            + f"\n\nSuggested by the QA agent ({s.model or 'model'}); confirmed by {user.display_name}."
        ),
        priority=body.priority or s.severity,
        labels=["qa", "qa-agent", f"suggestion:{s.id}"],
        payload={"suggestion": str(s.id)},
    )
    s.status, s.bug_id, s.decided_by, s.decided_at = (
        "accepted",
        bug.id,
        user.id,
        dt.datetime.now(dt.UTC),
    )
    s.reason = body.notes.strip() or None
    await session.commit()
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "projects")
    return {
        "id": str(s.id),
        "status": s.status,
        "bugId": str(bug.id),
        "bugKey": issue_rules.key(bug.number),
    }


class DismissIn(BaseModel):
    """Why the suggestion is not a bug."""

    reason: str = Field(min_length=rules.MIN_NOTES, max_length=2000)


@router.post("/api/qa-suggestions/{suggestion_id}/dismiss")
async def dismiss_suggestion(
    suggestion_id: uuid.UUID, body: DismissIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """QA rejects the suggestion and says why; the reason stays on record."""
    s, project = await _open_suggestion(session, user, suggestion_id)
    s.status, s.reason, s.decided_by, s.decided_at = (
        "dismissed",
        body.reason.strip(),
        user.id,
        dt.datetime.now(dt.UTC),
    )
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="qa.suggestion_dismissed",
        subject_type="issue",
        subject_id=s.issue_id,
        project_id=project.id,
        payload={"title": s.title, "reason": s.reason[:300]},
    )
    await session.commit()
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "projects")
    return {"id": str(s.id), "status": s.status}
