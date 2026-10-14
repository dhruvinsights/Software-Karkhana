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

"""Shared router helpers."""

from __future__ import annotations

import logging
import uuid
from typing import TypeVar

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import ledger, process
from app.models import Base, Project

logger = logging.getLogger(__name__)
M = TypeVar("M", bound=Base)


async def get_or_404(session: AsyncSession, model: type[M], obj_id: uuid.UUID) -> M:
    """Loads a row by primary key or raises 404."""
    obj = await session.get(model, obj_id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{model.__name__} not found")
    return obj


async def advance_or_http(
    session: AsyncSession,
    project: Project,
    event: process.Event,
    *,
    actor: ledger.Actor,
    role: process.Role | None,
    payload: dict | None = None,
) -> None:
    """Applies a user-triggered transition, mapping refusals to HTTP errors."""
    try:
        await process.advance(
            session, project, event, actor=actor, role=role, payload=payload
        )
    except process.ForbiddenTransition as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except process.TransitionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


async def lock_project(session: AsyncSession, project_id: uuid.UUID) -> Project:
    """Loads a project with a row lock, serializing run admission and outcomes."""
    from sqlalchemy import select

    project = await session.scalar(
        select(Project)
        .where(Project.id == project_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return project


async def advance_if_legal(
    session: AsyncSession,
    project: Project,
    event: process.Event,
    *,
    actor: ledger.Actor,
    payload: dict | None = None,
) -> bool:
    """Applies a platform-triggered transition when the table allows it.

    Several tasks can be in flight at once, so a system event (for example a
    second PR opening) may arrive when the project has already moved on. That
    is not an error; the run itself is still recorded in the ledger.
    """
    try:
        await process.advance(
            session, project, event, actor=actor, role=None, payload=payload
        )
        return True
    except process.TransitionError:
        logger.info(
            "Project %s: %s not applied at %s/%s",
            project.id,
            event,
            project.stage,
            project.stage_status,
        )
        await ledger.append(
            session,
            actor=actor,
            action="stage.event_not_applied",
            subject_type="project",
            subject_id=project.id,
            project_id=project.id,
            payload={
                "event": str(event),
                "at": f"{project.stage}/{project.stage_status}",
                **(payload or {}),
            },
        )
        return False
