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


"""Reading shared project context for people and agents."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ContextEntry
from app.schemas import ContextNote


async def recent(
    session: AsyncSession, project_id: uuid.UUID, limit: int = 12
) -> list[ContextEntry]:
    """Newest entries first."""
    return list(
        (
            await session.scalars(
                select(ContextEntry)
                .where(ContextEntry.project_id == project_id)
                .order_by(ContextEntry.created_at.desc())
                .limit(limit)
            )
        ).all()
    )


def as_notes(entries: list[ContextEntry]) -> list[ContextNote]:
    """Oldest first, the order an agent should read them."""
    return [
        ContextNote(id=str(e.id), kind=e.kind, title=e.title, body=e.body, author=e.author_label)
        for e in reversed(entries)
    ]
