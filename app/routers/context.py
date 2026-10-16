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

"""Shared project context for people and agents.

Decisions, notes and handoffs live in one append-only table. The Coder reads the
latest entries with its task and leaves a handoff when a run finishes, so the
next person (or agent) starts from what was actually decided.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app import ledger
from app.auth import CurrentUser
from app.db import get_session
from app.models import ContextEntry
from app.schemas import ContextIn, ContextOut
from app.services.context_notes import recent
from app.workspace_access import project_access

router = APIRouter(prefix="/api/projects/{project_id}/context", tags=["context"])
Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("", response_model=list[ContextOut])
async def list_context(
    project_id: uuid.UUID, session: Session, user: CurrentUser
) -> list[ContextEntry]:
    """Shared context for a project, newest first."""
    await project_access(session, user, project_id)
    return await recent(session, project_id, limit=100)


@router.post("", response_model=ContextOut, status_code=201)
async def add_context(
    project_id: uuid.UUID, body: ContextIn, session: Session, user: CurrentUser
) -> ContextEntry:
    """Adds a decision, note or handoff on behalf of the signed-in person."""
    (await project_access(session, user, project_id)).require_write()
    entry = ContextEntry(
        id=uuid.uuid4(),
        project_id=project_id,
        kind=body.kind,
        title=body.title.strip(),
        body=body.body.strip(),
        author_label=user.email,
        author_kind="human",
    )
    session.add(entry)
    await session.flush()
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action=f"context.{body.kind}",
        subject_type="context",
        subject_id=entry.id,
        project_id=project_id,
        payload={"title": entry.title},
    )
    await session.refresh(entry)
    return entry


@router.get("/export.md", response_class=PlainTextResponse)
async def export_markdown(
    project_id: uuid.UUID, session: Session, user: CurrentUser
) -> str:
    """The same context as Markdown, ready to commit next to the code."""
    project = (await project_access(session, user, project_id)).project
    lines = [f"# {project.name}: shared context", ""]
    for e in reversed(await recent(session, project_id, limit=500)):
        stamp = e.created_at.strftime("%Y-%m-%d %H:%M UTC")
        lines += [
            f"## {e.kind.title()}: {e.title}",
            f"_{e.author_label} · {stamp}_",
            "",
            e.body,
            "",
        ]
    return "\n".join(lines)
