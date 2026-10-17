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

"""The project plan: epics and stories as issues, approved by a lead."""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, db, ledger
from app.auth import CurrentUser
from app.models import Epic, Issue, Project
from app.routers.issues import _names, _out
from app.services import plan

router = APIRouter(tags=["plan"])
Session = Annotated[AsyncSession, Depends(db.get_session)]


async def _lead_project(session: AsyncSession, user: Any, project_id: uuid.UUID) -> Project:
    """Loads the project and requires a lead or manager."""
    project = await access.get_visible_project(session, user, project_id)
    mine = await access.my_access(session, user, project)
    if not (mine["canManage"] or mine["isLead"]):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only a project lead or manager can change the plan."
        )
    return project


@router.post("/api/projects/{project_id}/plan")
async def build_plan(project_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """Copies the drafted epics and stories into issues as drafts. Safe to repeat."""
    project = await _lead_project(session, user, project_id)
    has_epics = await session.scalar(select(Epic.id).where(Epic.project_id == project_id).limit(1))
    if has_epics is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The evaluation has not produced epics yet. Wait for it to finish.",
        )
    result = await plan.sync_plan(session, project, user)
    return {
        "epics": result.epics,
        "stories": result.stories,
        "created": result.created,
        "removed": result.removed,
    }


@router.get("/api/projects/{project_id}/plan")
async def get_plan(project_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """Epics with their stories, plus how many are still waiting for approval."""
    await access.get_visible_project(session, user, project_id)
    rows = list(
        (
            await session.scalars(
                select(Issue)
                .where(Issue.project_id == project_id, Issue.type.in_(("epic", "story")))
                .order_by(Issue.number)
            )
        ).all()
    )
    names = await _names(session, rows)
    children: dict[uuid.UUID, list[dict[str, Any]]] = {}
    for i in rows:
        if i.type == "story" and i.parent_id:
            children.setdefault(i.parent_id, []).append(_out(i, names))
    epics = [{**_out(i, names), "stories": children.get(i.id, [])} for i in rows if i.type == "epic"]
    return {
        "epics": epics,
        "draft": sum(1 for i in rows if i.status == "draft"),
        "total": len(rows),
    }


@router.post("/api/projects/{project_id}/plan/approve")
async def approve_plan(project_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """A lead accepts the plan: every draft moves to the backlog."""
    project = await _lead_project(session, user, project_id)
    moved = await plan.approve_plan(session, project)
    if moved == 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "There is no draft plan to approve.")
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="plan.approved",
        subject_type="project",
        subject_id=project.id,
        project_id=project.id,
        payload={"issues": moved},
    )
    return {"approved": moved}
