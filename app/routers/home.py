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

"""Workspace home: the product overview plus everything waiting on the caller."""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.idea_flow import ALL_STATIONS
from app.models import (
    ActivityEvent,
    Idea,
    Product,
    Project,
    ProjectMember,
    Task,
    Workspace,
    WorkspaceMember,
)
from app.workspace_access import (
    CurrentWorkspace,
    normalize_stations,
    visible_project_ids,
)

router = APIRouter(prefix="/api/home", tags=["home"])
Session = Annotated[AsyncSession, Depends(get_session)]

OPEN_TASK_STATUSES = ("backlog", "ready", "in_progress", "review")


@router.get("")
async def home(ws: CurrentWorkspace, session: Session) -> dict[str, Any]:
    """Product overview, my projects, my open tasks and idea counts in one call."""
    workspace = await session.get(Workspace, ws.workspace_id)
    product = await session.scalar(
        select(Product)
        .where(Product.workspace_id == ws.workspace_id, Product.archived_at.is_(None))
        .order_by(Product.created_at)
        .limit(1)
    )

    live_products = select(Product.id).where(
        Product.workspace_id == ws.workspace_id,
        Product.archived_at.is_(None),
    )
    stmt = (
        select(Project)
        .where(
            Project.workspace_id == ws.workspace_id,
            Project.archived_at.is_(None),
            Project.product_id.in_(live_products),
        )
        .order_by(Project.updated_at.desc())
    )
    visible = await visible_project_ids(session, ws)
    if visible is not None:
        stmt = stmt.where(Project.id.in_(visible))
    projects = list((await session.scalars(stmt)).all())
    project_ids = [p.id for p in projects]

    my_stations: dict[uuid.UUID, list[str]] = {
        m.project_id: normalize_stations(m.stations)
        for m in (
            await session.scalars(
                select(ProjectMember).where(
                    ProjectMember.user_id == ws.user.id,
                    ProjectMember.project_id.in_(project_ids),
                )
            )
        ).all()
    }
    open_counts: dict[uuid.UUID, int] = dict(
        (
            await session.execute(
                select(Task.project_id, func.count())
                .where(
                    Task.project_id.in_(project_ids),
                    Task.status.in_(OPEN_TASK_STATUSES),
                )
                .group_by(Task.project_id)
            )
        ).all()
    )
    member_counts: dict[uuid.UUID, int] = dict(
        (
            await session.execute(
                select(ProjectMember.project_id, func.count())
                .where(ProjectMember.project_id.in_(project_ids))
                .group_by(ProjectMember.project_id)
            )
        ).all()
    )

    names = {p.id: p.name for p in projects}
    my_tasks = (
        await session.scalars(
            select(Task)
            .where(
                Task.assignee_id == ws.user.id,
                Task.project_id.in_(project_ids),
                Task.status.in_(OPEN_TASK_STATUSES),
            )
            .order_by(Task.created_at.desc())
            .limit(25)
        )
    ).all()

    idea_counts: dict[str, int] = dict(
        (
            await session.execute(
                select(Idea.status, func.count())
                .where(Idea.workspace_id == ws.workspace_id)
                .group_by(Idea.status)
            )
        ).all()
    )
    recent_ideas = (
        await session.scalars(
            select(Idea)
            .where(Idea.workspace_id == ws.workspace_id)
            .order_by(Idea.updated_at.desc())
            .limit(5)
        )
    ).all()

    unread_activity = await session.scalar(
        select(func.count())
        .select_from(ActivityEvent)
        .where(
            ActivityEvent.workspace_id == ws.workspace_id,
            ActivityEvent.recipient_id == ws.user.id,
            ActivityEvent.read.is_(False),
        )
    )
    member_total = await session.scalar(
        select(func.count())
        .select_from(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == ws.workspace_id)
    )

    return {
        "workspace": {
            "id": str(workspace.id),
            "name": workspace.name,
            "slug": workspace.slug,
        },
        "product": (
            {
                "id": str(product.id),
                "name": product.name,
                "code": product.code,
                "domain": product.domain,
                "description": product.description,
                "settings": product.settings or {},
            }
            if product
            else None
        ),
        "me": {
            "id": str(ws.user.id),
            "name": ws.user.display_name,
            "email": ws.user.email,
            "title": ws.title,
            "isOwner": ws.is_owner,
            "isAdmin": ws.is_admin,
            "access": ws.access,
        },
        "memberCount": int(member_total or 0),
        "unreadActivity": int(unread_activity or 0),
        "projects": [
            {
                "id": str(p.id),
                "name": p.name,
                "stage": p.stage,
                "stageStatus": p.stage_status,
                "stations": my_stations.get(p.id, ALL_STATIONS),
                "openTasks": open_counts.get(p.id, 0),
                "members": member_counts.get(p.id, 0),
                "updatedAt": p.updated_at.isoformat(),
            }
            for p in projects
        ],
        "myTasks": [
            {
                "id": str(t.id),
                "key": t.key,
                "title": t.title,
                "status": t.status,
                "projectId": str(t.project_id),
                "projectName": names.get(t.project_id, ""),
            }
            for t in my_tasks
        ],
        "ideas": {
            "counts": idea_counts,
            "recent": [
                {
                    "id": str(i.id),
                    "title": i.title,
                    "status": i.status,
                    "updatedAt": i.updated_at.isoformat(),
                }
                for i in recent_ideas
            ],
        },
    }
