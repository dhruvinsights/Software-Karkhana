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

"""Idea approval workflow: request, decide, and create a staffed project.

PM creates an idea -> picks reviewers -> every reviewer approves (or one
rejects) -> a manager creates the project from the approved idea and enrols the
station leads, who can then enrol their own teams. Every step is written to the
evidence ledger. The rules live in :mod:`app.idea_flow`; this module only loads
rows, applies them and records what happened.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, db, ledger
from app import idea_flow as rules
from app.auth import CurrentUser
from app.models import (
    Idea,
    IdeaApproval,
    Project,
    ProjectMember,
    User,
    WorkspaceMember,
)
from app.process import Role
from app.services.evaluation import run_evaluation

router = APIRouter(prefix="/api", tags=["idea_flow"])
Session = Annotated[AsyncSession, Depends(db.get_session)]


class RequestApprovalIn(BaseModel):
    """Who must approve this idea."""

    reviewer_ids: list[uuid.UUID] = Field(min_length=1, max_length=rules.MAX_REVIEWERS)
    note: str = Field(default="", max_length=1000)


class DecisionIn(BaseModel):
    """A reviewer's verdict. A reason is required to reject."""

    decision: Literal["approve", "reject"]
    reason: str | None = Field(default=None, max_length=2000)


class LeadIn(BaseModel):
    """A person to enrol on the new project."""

    user_id: uuid.UUID
    role: str
    stations: list[str] | None = None
    is_lead: bool = True


class PromoteIn(BaseModel):
    """Options for creating a project from an approved idea."""

    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    repository_url: str | None = Field(default=None, max_length=500)
    target_release_date: str | None = Field(default=None, max_length=40)
    leads: list[LeadIn] = Field(default_factory=list, max_length=30)


async def _locked_idea(session: AsyncSession, idea_id: uuid.UUID) -> Idea:
    """Loads the idea with a row lock so concurrent decisions cannot interleave."""
    idea = await session.scalar(
        select(Idea).where(Idea.id == idea_id).with_for_update()
    )
    if idea is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Idea not found.")
    return idea


def _iso(value: dt.datetime | None) -> str | None:
    return value.isoformat() if value else None


async def _view(session: AsyncSession, idea: Idea) -> dict[str, Any]:
    """The idea's approval state, as the UI renders it."""
    rows = (
        await session.execute(
            select(IdeaApproval, User)
            .join(User, User.id == IdeaApproval.reviewer_id)
            .where(IdeaApproval.idea_id == idea.id)
            .order_by(IdeaApproval.requested_at, User.email)
        )
    ).all()
    approvals = [
        {
            "id": str(a.id),
            "reviewerId": str(u.id),
            "reviewerName": u.display_name,
            "reviewerEmail": u.email,
            "status": a.status,
            "reason": a.reason,
            "note": a.note,
            "requestedAt": _iso(a.requested_at),
            "decidedAt": _iso(a.decided_at),
        }
        for a, u in rows
    ]
    return {
        "ideaId": str(idea.id),
        "status": idea.status,
        "projectId": str(idea.project_id) if idea.project_id else None,
        "approvals": approvals,
        "approvedCount": sum(1 for a in approvals if a["status"] == rules.APPROVED),
        "totalReviewers": len(approvals),
    }


@router.get("/ideas/{idea_id}/approvals")
async def idea_approvals(
    idea_id: uuid.UUID, session: Session, _: CurrentUser
) -> dict[str, Any]:
    """Reviewers and their decisions for one idea."""
    idea = await session.get(Idea, idea_id)
    if idea is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Idea not found.")
    return await _view(session, idea)


@router.post("/ideas/{idea_id}/request-approval")
async def request_approval(
    idea_id: uuid.UUID,
    body: RequestApprovalIn,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Puts the idea up for approval by the chosen reviewers.

    Re-requesting (for example after a rejection) replaces the reviewer list
    and starts every decision again; the ledger keeps the earlier history.
    """
    idea = await _locked_idea(session, idea_id)
    if not rules.can_request_approval(
        role=await access.effective_role(session, user, idea.workspace_id),
        is_author=idea.author_id == user.id,
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the idea's author or a product manager can request approval.",
        )
    if idea.status in (rules.IDEA_APPROVED, rules.IDEA_PROMOTED):
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"This idea is already {idea.status}."
        )
    try:
        reviewer_ids = rules.clean_reviewers(user.id, body.reviewer_ids)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    users = {
        u.id: u
        for u in (
            await session.scalars(select(User).where(User.id.in_(reviewer_ids)))
        ).all()
    }
    unknown = [str(i) for i in reviewer_ids if i not in users]
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Unknown reviewer(s): " + ", ".join(unknown),
        )
    if idea.workspace_id:
        member_ids = set(
            (
                await session.scalars(
                    select(WorkspaceMember.user_id).where(
                        WorkspaceMember.workspace_id == idea.workspace_id,
                        WorkspaceMember.user_id.in_(reviewer_ids),
                    )
                )
            ).all()
        )
        outside = [users[i].email for i in reviewer_ids if i not in member_ids]
        if outside:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Not members of this workspace: " + ", ".join(outside),
            )

    await session.execute(delete(IdeaApproval).where(IdeaApproval.idea_id == idea.id))
    note = body.note.strip() or None
    for rid in reviewer_ids:
        session.add(
            IdeaApproval(
                id=uuid.uuid4(),
                idea_id=idea.id,
                reviewer_id=rid,
                requested_by=user.id,
                status=rules.PENDING,
                note=note,
            )
        )
    idea.status = rules.IDEA_PENDING
    await session.flush()
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="idea.approval_requested",
        subject_type="idea",
        subject_id=idea.id,
        payload={
            "title": idea.title,
            "reviewers": [users[i].email for i in reviewer_ids],
            "note": note,
        },
    )
    return await _view(session, idea)


@router.post("/ideas/{idea_id}/decision")
async def decide(
    idea_id: uuid.UUID,
    body: DecisionIn,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """An assigned reviewer approves or rejects. All must approve; one reject stops it."""
    idea = await _locked_idea(session, idea_id)
    mine = await session.scalar(
        select(IdeaApproval).where(
            IdeaApproval.idea_id == idea.id, IdeaApproval.reviewer_id == user.id
        )
    )
    if mine is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You are not a reviewer for this idea."
        )
    if mine.status != rules.PENDING:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"You already {mine.status} this idea."
        )
    reason = (body.reason or "").strip() or None
    if body.decision == "reject" and not reason:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "A reason is required to reject."
        )
    mine.status = rules.APPROVED if body.decision == "approve" else rules.REJECTED
    mine.reason, mine.decided_at = reason, dt.datetime.now(dt.UTC)
    await session.flush()

    statuses = (
        await session.scalars(
            select(IdeaApproval.status).where(IdeaApproval.idea_id == idea.id)
        )
    ).all()
    outcome = rules.tally(statuses)
    actor = ledger.Actor.human(user)
    await ledger.append(
        session,
        actor=actor,
        action=f"idea.review_{mine.status}",
        subject_type="idea",
        subject_id=idea.id,
        payload={"title": idea.title, "reason": reason},
    )
    if outcome != idea.status and outcome in (rules.IDEA_APPROVED, rules.IDEA_REJECTED):
        idea.status = outcome
        await ledger.append(
            session,
            actor=ledger.SYSTEM,
            action=f"idea.{outcome}",
            subject_type="idea",
            subject_id=idea.id,
            payload={"title": idea.title, "reviewers": len(statuses)},
        )
    return await _view(session, idea)


@router.get("/idea-approvals/inbox")
async def inbox(session: Session, user: CurrentUser) -> list[dict[str, Any]]:
    """Ideas waiting for the signed-in user's decision, newest first."""
    rows = (
        await session.execute(
            select(IdeaApproval, Idea)
            .join(Idea, Idea.id == IdeaApproval.idea_id)
            .where(
                IdeaApproval.reviewer_id == user.id,
                IdeaApproval.status == rules.PENDING,
            )
            .order_by(IdeaApproval.requested_at.desc())
        )
    ).all()
    requester_ids = {a.requested_by for a, _ in rows}
    names = (
        {
            u.id: u.display_name
            for u in (
                await session.scalars(select(User).where(User.id.in_(requester_ids)))
            ).all()
        }
        if requester_ids
        else {}
    )
    return [
        {
            "ideaId": str(i.id),
            "title": i.title,
            "problemStatement": i.problem_statement,
            "expectedValue": i.expected_value,
            "assessment": i.assessment,
            "requestedBy": names.get(a.requested_by, "Unknown"),
            "note": a.note,
            "requestedAt": _iso(a.requested_at),
        }
        for a, i in rows
    ]


@router.post("/ideas/{idea_id}/promote", status_code=status.HTTP_201_CREATED)
async def promote_idea_to_project(
    idea_id: uuid.UUID,
    session: Session,
    user: CurrentUser,
    background: BackgroundTasks,
    body: PromoteIn | None = None,
) -> dict[str, Any]:
    """Creates a project from an approved idea and enrols its station leads.

    Refuses unless every assigned reviewer approved. The caller becomes the
    project lead with every station; each person in ``leads`` is enrolled with
    their role's default stations (or the ones given) and, when ``is_lead``,
    may add their own team. The evaluation starts in the background, exactly as
    for a project created directly.
    """
    body = body or PromoteIn()
    idea = await _locked_idea(session, idea_id)
    my_role = await access.effective_role(session, user, idea.workspace_id)
    if not rules.can_promote(my_role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only a product manager or lead can create a project.",
        )
    if idea.project_id is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"A project already exists for this idea ({idea.project_id}).",
        )
    if idea.status != rules.IDEA_APPROVED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Every assigned reviewer must approve the idea first "
            f"(current status: {idea.status}).",
        )

    valid_roles = {r.value for r in Role}
    leads: dict[uuid.UUID, LeadIn] = {}
    for lead in body.leads:
        if lead.role not in valid_roles:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown role: {lead.role}"
            )
        bad = set(lead.stations or []) - set(rules.ALL_STATIONS)
        if bad:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Unknown station(s): " + ", ".join(sorted(bad)),
            )
        leads[lead.user_id] = lead  # last entry for a person wins
    leads.pop(user.id, None)  # the caller is enrolled below

    people = {
        u.id: u
        for u in (
            await session.scalars(select(User).where(User.id.in_(list(leads))))
        ).all()
    }
    missing = [str(i) for i in leads if i not in people]
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Unknown user(s): " + ", ".join(missing),
        )
    if idea.workspace_id and leads:
        in_ws = set(
            (
                await session.scalars(
                    select(WorkspaceMember.user_id).where(
                        WorkspaceMember.workspace_id == idea.workspace_id,
                        WorkspaceMember.user_id.in_(list(leads)),
                    )
                )
            ).all()
        )
        outside = [people[i].email for i in leads if i not in in_ws]
        if outside:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Not members of this workspace: " + ", ".join(outside),
            )

    # Projects born from an approved idea are limited to the team named on them.
    settings: dict[str, Any] = {"idea_id": str(idea.id), "access": "restricted"}
    if body.description:
        settings["description"] = body.description
    if body.repository_url:
        settings["repository_url"] = body.repository_url
    if body.target_release_date:
        settings["target_release_date"] = body.target_release_date

    project = Project(
        id=uuid.uuid4(),
        product_id=idea.product_id,
        workspace_id=idea.workspace_id,
        lead_id=user.id,
        idea_id=idea.id,
        name=(body.name or idea.title).strip(),
        idea_text=f"{idea.problem_statement}\n\nExpected Value:\n{idea.expected_value}",
        created_by=user.id,
        stage="evaluate",
        stage_status="submitted",
        settings=settings,
    )
    session.add(project)
    await session.flush()

    members: list[dict[str, Any]] = []

    def enrol(uid: uuid.UUID, role: str, stations: list[str], is_lead: bool) -> None:
        session.add(
            ProjectMember(
                id=uuid.uuid4(),
                project_id=project.id,
                user_id=uid,
                role=role,
                stations=stations,
                is_lead=is_lead,
            )
        )
        members.append(
            {"userId": str(uid), "role": role, "stations": stations, "isLead": is_lead}
        )

    enrol(user.id, my_role if my_role in rules.ROLE_STATIONS else user.role, list(rules.ALL_STATIONS), True)
    for uid, lead in leads.items():
        enrol(
            uid, lead.role, lead.stations or rules.stations_for(lead.role), lead.is_lead
        )

    idea.status = rules.IDEA_PROMOTED
    idea.project_id = project.id
    await session.flush()

    actor = ledger.Actor.human(user)
    await ledger.append(
        session,
        actor=actor,
        action="idea.promoted",
        subject_type="project",
        subject_id=project.id,
        project_id=project.id,
        payload={"idea_id": str(idea.id), "project_name": project.name},
    )
    await ledger.append(
        session,
        actor=actor,
        action="project.staffed",
        subject_type="project",
        subject_id=project.id,
        project_id=project.id,
        payload={
            "members": [{"user": m["userId"], "role": m["role"]} for m in members]
        },
    )
    await session.commit()
    background.add_task(run_evaluation, project.id)
    return {
        "status": "promoted",
        "projectId": str(project.id),
        "projectName": project.name,
        "ideaId": str(idea.id),
        "members": members,
    }
