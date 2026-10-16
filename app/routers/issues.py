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

"""Issues and bugs: raised by anyone on the team, assigned to whoever fixes them."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, db, issue_rules, ledger
from app.auth import CurrentUser
from app.models import Issue, Project, User

router = APIRouter(tags=["issues"])
Session = Annotated[AsyncSession, Depends(db.get_session)]


class IssueIn(BaseModel):
    """Request body for creating an issue."""

    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=8000)
    type: str = "task"
    priority: str = "P2"
    labels: list[str] = Field(default_factory=list, max_length=20)
    assignee_id: uuid.UUID | None = None
    source: str = "manual"
    task_id: uuid.UUID | None = None
    pr_id: uuid.UUID | None = None


class IssuePatch(BaseModel):
    """Request body for partially updating an issue."""

    title: str | None = Field(default=None, min_length=3, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    type: str | None = None
    priority: str | None = None
    status: str | None = None
    labels: list[str] | None = Field(default=None, max_length=20)
    assignee_id: uuid.UUID | None = None  # sent as null (and present) to unassign


def _out(i: Issue, names: dict[uuid.UUID, str]) -> dict[str, Any]:
    return {
        "id": str(i.id),
        "projectId": str(i.project_id),
        "number": i.number,
        "key": issue_rules.key(i.number),
        "title": i.title,
        "description": i.description,
        "type": i.type,
        "priority": i.priority,
        "status": i.status,
        "source": i.source,
        "labels": i.labels or [],
        "reporterId": str(i.reporter_id),
        "reporterName": names.get(i.reporter_id, ""),
        "assigneeId": str(i.assignee_id) if i.assignee_id else None,
        "assigneeName": names.get(i.assignee_id, "") if i.assignee_id else None,
        "taskId": str(i.task_id) if i.task_id else None,
        "prId": str(i.pr_id) if i.pr_id else None,
        "createdAt": i.created_at.isoformat(),
        "updatedAt": i.updated_at.isoformat(),
        "closedAt": i.closed_at.isoformat() if i.closed_at else None,
    }


async def _names(session: AsyncSession, issues: list[Issue]) -> dict[uuid.UUID, str]:
    ids = {i.reporter_id for i in issues} | {i.assignee_id for i in issues if i.assignee_id}
    if not ids:
        return {}
    rows = (await session.scalars(select(User).where(User.id.in_(ids)))).all()
    return {u.id: u.display_name for u in rows}


async def _check_assignee(session: AsyncSession, project: Project, assignee_id: uuid.UUID) -> None:
    person = await session.get(User, assignee_id)
    if person is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Assignee not found.")
    try:
        await access.ensure_station(session, person, project)
    except HTTPException as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"{person.display_name} is not on this project."
        ) from exc


@router.get("/api/projects/{project_id}/issues")
async def list_issues(
    project_id: uuid.UUID,
    session: Session,
    user: CurrentUser,
    status_: Annotated[str | None, Query(alias="status")] = None,
    assignee_id: uuid.UUID | None = None,
    type: str | None = None,
    mine: bool = False,
) -> list[dict[str, Any]]:
    """Issues of a project, newest first."""
    await access.get_visible_project(session, user, project_id)
    stmt = select(Issue).where(Issue.project_id == project_id).order_by(Issue.number.desc())
    if status_:
        stmt = stmt.where(Issue.status == status_)
    if type:
        stmt = stmt.where(Issue.type == type)
    if mine:
        stmt = stmt.where(Issue.assignee_id == user.id)
    elif assignee_id:
        stmt = stmt.where(Issue.assignee_id == assignee_id)
    rows = list((await session.scalars(stmt.limit(500))).all())
    names = await _names(session, rows)
    return [_out(i, names) for i in rows]


@router.get("/api/issues/mine")
async def my_issues(session: Session, user: CurrentUser) -> list[dict[str, Any]]:
    """Open issues assigned to the signed-in user, across the projects they can see."""
    stmt = (
        select(Issue)
        .join(Project, Project.id == Issue.project_id)
        .where(
            Issue.assignee_id == user.id,
            Issue.status.not_in(tuple(issue_rules.CLOSED)),
            access.visible_projects(user),
        )
        .order_by(Issue.priority, Issue.updated_at.desc())
        .limit(200)
    )
    rows = list((await session.scalars(stmt)).all())
    names = await _names(session, rows)
    return [_out(i, names) for i in rows]


@router.post("/api/projects/{project_id}/issues", status_code=status.HTTP_201_CREATED)
async def create_issue(
    project_id: uuid.UUID, body: IssueIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Raises an issue. Anyone on the project can; assigning to others needs a lead."""
    project = await access.get_visible_project(session, user, project_id)
    problem = issue_rules.validate(type_=body.type, priority=body.priority)
    if problem or body.source not in issue_rules.SOURCES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, problem or "Unknown source.")

    mine = await access.my_access(session, user, project)
    is_lead = bool(mine["canManage"] or mine["isLead"])
    ok, why = issue_rules.can_assign(
        actor_id=user.id, assignee_id=body.assignee_id, actor_is_lead=is_lead
    )
    if not ok:
        raise HTTPException(status.HTTP_403_FORBIDDEN, why)
    if body.assignee_id and body.assignee_id != user.id:
        await _check_assignee(session, project, body.assignee_id)

    # Serialise numbering per project so two people never get the same number.
    await session.execute(select(Project.id).where(Project.id == project_id).with_for_update())
    number = (
        await session.scalar(
            select(func.coalesce(func.max(Issue.number), 0)).where(Issue.project_id == project_id)
        )
    ) + 1
    issue = Issue(
        id=uuid.uuid4(),
        project_id=project_id,
        number=number,
        title=body.title.strip(),
        description=body.description,
        type=body.type,
        priority=body.priority,
        status="todo",
        source=body.source,
        labels=body.labels,
        reporter_id=user.id,
        assignee_id=body.assignee_id,
        task_id=body.task_id,
        pr_id=body.pr_id,
    )
    session.add(issue)
    await session.flush()
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="issue.created",
        subject_type="issue",
        subject_id=issue.id,
        project_id=project_id,
        payload={
            "key": issue_rules.key(number),
            "type": body.type,
            "priority": body.priority,
            "assignee_id": str(body.assignee_id) if body.assignee_id else None,
        },
    )
    names = await _names(session, [issue])
    return _out(issue, names)


@router.patch("/api/issues/{issue_id}")
async def update_issue(
    issue_id: uuid.UUID, body: IssuePatch, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Edits, reassigns or moves an issue. Reporter, assignee or a lead may do so."""
    issue = await session.scalar(select(Issue).where(Issue.id == issue_id).with_for_update())
    if issue is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Issue not found.")
    project = await access.get_visible_project(session, user, issue.project_id)
    mine = await access.my_access(session, user, project)
    is_lead = bool(mine["canManage"] or mine["isLead"])

    assigning = "assignee_id" in body.model_fields_set
    # Taking an unassigned issue for yourself is always fine; everything else needs a stake.
    taking = assigning and body.assignee_id == user.id and issue.assignee_id is None
    if not taking and not issue_rules.can_modify(
        actor_id=user.id,
        reporter_id=issue.reporter_id,
        assignee_id=issue.assignee_id,
        actor_is_lead=is_lead,
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the reporter, the assignee or a lead can change this issue.")

    problem = issue_rules.validate(type_=body.type, priority=body.priority, status=body.status)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, problem)

    changes: dict[str, Any] = {}
    if assigning:
        ok, why = issue_rules.can_assign(
            actor_id=user.id, assignee_id=body.assignee_id, actor_is_lead=is_lead
        )
        if not ok:
            raise HTTPException(status.HTTP_403_FORBIDDEN, why)
        if body.assignee_id and body.assignee_id != user.id:
            await _check_assignee(session, project, body.assignee_id)
        if body.assignee_id != issue.assignee_id:
            changes["assignee_id"] = str(body.assignee_id) if body.assignee_id else None
            issue.assignee_id = body.assignee_id
    for field in ("title", "description", "type", "priority", "labels"):
        value = getattr(body, field)
        if value is not None and value != getattr(issue, field):
            changes[field] = value
            setattr(issue, field, value.strip() if isinstance(value, str) and field == "title" else value)
    if body.status is not None and body.status != issue.status:
        changes["status"] = body.status
        issue.status = body.status
        issue.closed_at = dt.datetime.now(dt.UTC) if body.status in issue_rules.CLOSED else None

    if changes:
        issue.updated_at = dt.datetime.now(dt.UTC)
        action = (
            "issue.assigned"
            if set(changes) == {"assignee_id"}
            else "issue.status_changed"
            if set(changes) == {"status"}
            else "issue.updated"
        )
        await ledger.append(
            session,
            actor=ledger.Actor.human(user),
            action=action,
            subject_type="issue",
            subject_id=issue.id,
            project_id=issue.project_id,
            payload={"key": issue_rules.key(issue.number), **changes},
        )
    names = await _names(session, [issue])
    return _out(issue, names)
