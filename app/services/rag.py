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

"""Workspace-scoped RAG knowledge base on Postgres + pgvector.

Every document, chunk and chat turn carries its ``workspace_id`` and every
query filters on it in SQL, so one tenant's rows are never candidates for
another tenant's search. Within a workspace, a document tied to a project is
only visible to people who can see that project (``access.visible_projects``).

Embeddings use the same provider layer as learnings (``llm.embed``), and only
vectors from the current embedding model are compared. When embedding is
unavailable the chunk is still stored and found by keyword search.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access import visible_projects
from app.ai import llm
from app.ai.errors import ModelError
from app.models import Project, RagChatMessage, RagChunk, RagDocument

CHUNK_SIZE = 800
CHUNK_OVERLAP = 150
TOP_K = 4
MAX_CHUNKS_PER_DOC = 400


def chunk_text(
    text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP
) -> list[str]:
    """Splits text into overlapping chunks, preferring paragraph and line breaks."""
    text = text.strip()
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            window = text[start:end]
            for sep in ("\n\n", "\n", ". ", " "):
                cut = window.rfind(sep)
                if cut > size // 2:
                    end = start + cut + len(sep)
                    break
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


def _visible(user) -> object:
    """Documents the user may read inside a workspace they belong to."""
    return or_(
        RagDocument.project_id.is_(None),
        RagDocument.project_id.in_(select(Project.id).where(visible_projects(user))),
    )


async def ingest(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user,
    title: str,
    content: str,
    tags: list[str],
    project_id: uuid.UUID | None = None,
) -> tuple[RagDocument, int]:
    """Stores a document and its embedded chunks. Caller has checked membership."""
    doc = RagDocument(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        project_id=project_id,
        title=title,
        tags=list(tags),
        content_chars=len(content),
        created_by=user.id,
    )
    session.add(doc)
    await session.flush()
    model = llm.embed_model_name()
    chunks = chunk_text(content)[:MAX_CHUNKS_PER_DOC]
    for i, piece in enumerate(chunks):
        try:
            vec: list[float] | None = await llm.embed(
                piece, task_type="RETRIEVAL_DOCUMENT"
            )
        except ModelError:
            vec = None
        session.add(
            RagChunk(
                document_id=doc.id,
                workspace_id=workspace_id,
                chunk_index=i,
                chunk_text=piece,
                embedding=vec,
                embedding_model=model if vec is not None else None,
            )
        )
    await session.commit()
    return doc, len(chunks)


@dataclass
class Hit:
    """One retrieved chunk and its document title."""

    title: str
    text: str
    score: float


async def retrieve(
    session: AsyncSession, *, workspace_id: uuid.UUID, user, query: str, k: int = TOP_K
) -> list[Hit]:
    """Top-k chunks for ``query`` from this workspace only."""
    base = (
        select(RagChunk, RagDocument.title)
        .join(
            RagDocument,
            (RagDocument.id == RagChunk.document_id)
            & (RagDocument.workspace_id == RagChunk.workspace_id),
        )
        .where(RagChunk.workspace_id == workspace_id, _visible(user))
    )
    try:
        qvec = await llm.embed(query, task_type="RETRIEVAL_QUERY")
    except ModelError:
        qvec = None
    if qvec is not None:
        distance = RagChunk.embedding.cosine_distance(qvec)
        rows = (
            await session.execute(
                base.add_columns(distance.label("d"))
                .where(
                    RagChunk.embedding.is_not(None),
                    RagChunk.embedding_model == llm.embed_model_name(),
                )
                .order_by(distance)
                .limit(k)
            )
        ).all()
        if rows:
            return [Hit(t, c.chunk_text, 1.0 - float(d)) for c, t, d in rows]
    # Keyword fallback: no embeddings (offline) or none from this model.
    words = re.findall(r"\w{3,}", query.lower())[:8]
    if not words:
        return []
    rows = (
        await session.execute(
            base.where(or_(*(RagChunk.chunk_text.ilike(f"%{w}%") for w in words)))
            .order_by(RagChunk.created_at.desc())
            .limit(k)
        )
    ).all()
    return [Hit(t, c.chunk_text, 0.0) for c, t in rows]


async def list_documents(
    session: AsyncSession, *, workspace_id: uuid.UUID, user
) -> list[tuple[RagDocument, int]]:
    """Documents in this workspace with their chunk counts, newest first."""
    counts = (
        select(RagChunk.document_id, func.count().label("n"))
        .where(RagChunk.workspace_id == workspace_id)
        .group_by(RagChunk.document_id)
        .subquery()
    )
    rows = await session.execute(
        select(RagDocument, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.document_id == RagDocument.id)
        .where(RagDocument.workspace_id == workspace_id, _visible(user))
        .order_by(RagDocument.created_at.desc())
    )
    return [(d, int(n)) for d, n in rows.all()]


async def delete_document(
    session: AsyncSession, *, workspace_id: uuid.UUID, user, doc_id: uuid.UUID
) -> bool:
    """Deletes one document (chunks cascade) if it is in this workspace and visible."""
    res = await session.execute(
        delete(RagDocument).where(
            RagDocument.id == doc_id,
            RagDocument.workspace_id == workspace_id,
            _visible(user),
        )
    )
    await session.commit()
    return res.rowcount > 0


async def history(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    session_id: str,
) -> list[RagChatMessage]:
    """This user's turns in one chat session in one workspace, oldest first."""
    return list(
        (
            await session.scalars(
                select(RagChatMessage)
                .where(
                    RagChatMessage.workspace_id == workspace_id,
                    RagChatMessage.user_id == user_id,
                    RagChatMessage.session_id == session_id,
                )
                .order_by(RagChatMessage.created_at, RagChatMessage.id)
            )
        ).all()
    )


async def append_turns(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    session_id: str,
    question: str,
    reply: str,
    sources: list[str],
) -> None:
    """Records one question and its answer."""
    session.add(
        RagChatMessage(
            workspace_id=workspace_id, user_id=user_id, session_id=session_id,
            role="user", content=question, sources=[],
        )
    )  # fmt: skip
    await session.flush()  # separate statements keep clock_timestamp ordering
    session.add(
        RagChatMessage(
            workspace_id=workspace_id, user_id=user_id, session_id=session_id,
            role="assistant", content=reply, sources=sources,
        )
    )  # fmt: skip
    await session.commit()


async def clear_history(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    session_id: str,
) -> None:
    """Deletes this user's turns in one session."""
    await session.execute(
        delete(RagChatMessage).where(
            RagChatMessage.workspace_id == workspace_id,
            RagChatMessage.user_id == user_id,
            RagChatMessage.session_id == session_id,
        )
    )
    await session.commit()
