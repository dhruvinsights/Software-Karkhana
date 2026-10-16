"""RAG (retrieval-augmented generation) over a workspace's knowledge base.

Provides:
  POST   /api/rag/chat                  chat grounded in the workspace's documents
  GET    /api/rag/history/{session_id}  this user's history for a chat session
  DELETE /api/rag/history/{session_id}  clear it
  POST   /api/rag/ingest                ingest a text/markdown document
  GET    /api/rag/documents             list the workspace's documents
  DELETE /api/rag/documents/{id}        remove a document
  GET    /api/workspaces/{workspace_id}/members  workspace member list

Every endpoint takes ``workspace_id`` and refuses callers who are not members.
Storage is Postgres + pgvector (``app.services.rag``, migration 015): rows carry
``workspace_id`` and every query filters on it in SQL, history is private to
one user in one workspace, and nothing is lost on restart. The model call goes
through ``llm.generate_text``, so the retrieved context is compressed with
Headroom before it is sent.
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.access import get_visible_project
from app.ai import llm
from app.ai.errors import ModelError
from app.auth import CurrentUser
from app.models import User, WorkspaceMember
from app.services import rag as rag_store

logger = logging.getLogger(__name__)
router = APIRouter(tags=["rag"])
Session = Annotated[AsyncSession, Depends(db.get_session)]

SYSTEM_PROMPT = (
    "You are the Software Karkhana Factory AI, a senior engineering assistant "
    "with knowledge of the team's codebase, architecture decisions and product "
    "context. Be concise, precise and practical. Ground answers in the provided "
    "knowledge-base context when it is relevant, and say when it is not."
)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class ChatMessage(BaseModel):
    """One chat turn."""

    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    """A question for the workspace's knowledge base."""

    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()), max_length=200)
    message: str = Field(min_length=1, max_length=20_000)
    workspace_id: str
    project_id: str | None = None
    stream: bool = False


class ChatResponse(BaseModel):
    """The answer, its sources and the session history."""

    session_id: str
    reply: str
    sources: list[str] = Field(default_factory=list)
    history: list[ChatMessage] = Field(default_factory=list)


class IngestRequest(BaseModel):
    """A text or Markdown document to add."""

    title: str = Field(min_length=1, max_length=500)
    content: str = Field(min_length=1, max_length=2_000_000)
    workspace_id: str
    project_id: str | None = None
    tags: list[str] = Field(default_factory=list)


class DocumentOut(BaseModel):
    """A stored document."""

    id: str
    title: str
    tags: list[str]
    created_at: str
    chunk_count: int
    project_id: str | None = None


async def _require_workspace_member(
    session: AsyncSession, user: User, workspace_id: str
) -> uuid.UUID:
    """Refuses RAG operations outside a workspace the caller belongs to."""
    try:
        workspace_uuid = uuid.UUID(workspace_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found") from exc
    member = await session.scalar(
        select(WorkspaceMember.id).where(
            WorkspaceMember.workspace_id == workspace_uuid,
            WorkspaceMember.user_id == user.id,
        )
    )
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    return workspace_uuid


async def _project_in_workspace(
    session: AsyncSession, user: User, workspace_id: uuid.UUID, project_id: str | None
) -> uuid.UUID | None:
    """Validates an optional project: visible to the caller and in this workspace."""
    if not project_id:
        return None
    try:
        pid = uuid.UUID(project_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found") from exc
    project = await get_visible_project(session, user, pid)
    if project.workspace_id != workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return pid


def _build_rag_prompt(user_message: str, retrieved_context: str) -> str:
    """The user turn, augmented with retrieved context."""
    if retrieved_context:
        return (
            "=== RETRIEVED KNOWLEDGE BASE CONTEXT ===\n"
            f"{retrieved_context}\n"
            "=== END CONTEXT ===\n\n"
            f"Question: {user_message}"
        )
    return user_message


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------


@router.post("/api/rag/chat", response_model=ChatResponse)
async def rag_chat(
    payload: ChatRequest, user: CurrentUser, session: Session
) -> ChatResponse:
    """RAG chat grounded in this workspace's documents."""
    ws = await _require_workspace_member(session, user, payload.workspace_id)
    await _project_in_workspace(session, user, ws, payload.project_id)
    prior = await rag_store.history(
        session, workspace_id=ws, user_id=user.id, session_id=payload.session_id
    )
    hits = await rag_store.retrieve(
        session, workspace_id=ws, user=user, query=payload.message
    )
    context_text = "\n\n---\n\n".join(f"[{h.title}]\n{h.text}" for h in hits)
    sources = list(dict.fromkeys(h.title for h in hits))

    turns = [{"role": m.role, "content": m.content} for m in prior[-10:]]
    turns.append(
        {"role": "user", "content": _build_rag_prompt(payload.message, context_text)}
    )
    reply_text = ""
    if llm.text_configured():
        try:
            reply_text = await llm.generate_text(
                messages=turns, system=SYSTEM_PROMPT, kind="rag", timeout_s=60
            )
        except ModelError as exc:
            logger.warning("RAG model call failed: %s", exc)
    if not reply_text:
        reply_text = _fallback_reply(payload.message, context_text)

    await rag_store.append_turns(
        session,
        workspace_id=ws,
        user_id=user.id,
        session_id=payload.session_id,
        question=payload.message,
        reply=reply_text,
        sources=sources,
    )
    history = [ChatMessage(role=m.role, content=m.content) for m in prior] + [
        ChatMessage(role="user", content=payload.message),
        ChatMessage(role="assistant", content=reply_text),
    ]
    return ChatResponse(
        session_id=payload.session_id,
        reply=reply_text,
        sources=sources,
        history=history,
    )


@router.get("/api/rag/history/{session_id}")
async def get_chat_history(
    session_id: str,
    user: CurrentUser,
    session: Session,
    workspace_id: str = Query(...),
) -> list[ChatMessage]:
    """This user's history for one chat session in one workspace."""
    ws = await _require_workspace_member(session, user, workspace_id)
    rows = await rag_store.history(
        session, workspace_id=ws, user_id=user.id, session_id=session_id
    )
    return [ChatMessage(role=m.role, content=m.content) for m in rows]


@router.delete("/api/rag/history/{session_id}", status_code=204)
async def clear_chat_history(
    session_id: str,
    user: CurrentUser,
    session: Session,
    workspace_id: str = Query(...),
) -> None:
    """Clears this user's history for one chat session."""
    ws = await _require_workspace_member(session, user, workspace_id)
    await rag_store.clear_history(
        session, workspace_id=ws, user_id=user.id, session_id=session_id
    )


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


def _doc_out(doc, chunk_count: int) -> DocumentOut:
    return DocumentOut(
        id=str(doc.id),
        title=doc.title,
        tags=list(doc.tags or []),
        created_at=doc.created_at.isoformat() if doc.created_at else "",
        chunk_count=chunk_count,
        project_id=str(doc.project_id) if doc.project_id else None,
    )


@router.post(
    "/api/rag/ingest", status_code=status.HTTP_201_CREATED, response_model=DocumentOut
)
async def ingest_document(
    payload: IngestRequest, user: CurrentUser, session: Session
) -> DocumentOut:
    """Chunks, embeds and stores a document in this workspace's knowledge base."""
    ws = await _require_workspace_member(session, user, payload.workspace_id)
    pid = await _project_in_workspace(session, user, ws, payload.project_id)
    doc, n = await rag_store.ingest(
        session,
        workspace_id=ws,
        user=user,
        title=payload.title,
        content=payload.content,
        tags=payload.tags,
        project_id=pid,
    )
    await session.refresh(doc)
    return _doc_out(doc, n)


@router.get("/api/rag/documents", response_model=list[DocumentOut])
async def list_documents(
    user: CurrentUser, session: Session, workspace_id: str = Query(...)
) -> list[DocumentOut]:
    """Lists this workspace's documents, newest first."""
    ws = await _require_workspace_member(session, user, workspace_id)
    rows = await rag_store.list_documents(session, workspace_id=ws, user=user)
    return [_doc_out(d, n) for d, n in rows]


@router.delete("/api/rag/documents/{doc_id}", status_code=204)
async def delete_document(
    doc_id: str,
    user: CurrentUser,
    session: Session,
    workspace_id: str = Query(...),
) -> None:
    """Removes a document and its chunks from this workspace."""
    ws = await _require_workspace_member(session, user, workspace_id)
    try:
        did = uuid.UUID(doc_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found") from exc
    if not await rag_store.delete_document(
        session, workspace_id=ws, user=user, doc_id=did
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")


# ---------------------------------------------------------------------------
# Workspace members
# ---------------------------------------------------------------------------


@router.get("/api/workspaces/{workspace_id}/members")
async def list_workspace_members(
    workspace_id: str,
    session: Session,
    user: CurrentUser,
) -> list[dict[str, Any]]:
    """Returns all members of a workspace with their roles and avatars."""
    await _require_workspace_member(session, user, workspace_id)
    try:
        members = (
            await session.scalars(
                select(WorkspaceMember)
                .where(WorkspaceMember.workspace_id == uuid.UUID(workspace_id))
                .order_by(WorkspaceMember.joined_at.asc())
            )
        ).all()

        user_ids = [m.user_id for m in members]
        if not user_ids:
            return []

        users = (await session.scalars(select(User).where(User.id.in_(user_ids)))).all()
        user_map = {u.id: u for u in users}

        return [
            {
                "id": str(m.user_id),
                "name": user_map[m.user_id].display_name
                if m.user_id in user_map
                else "Unknown",
                "email": user_map[m.user_id].email if m.user_id in user_map else "",
                "role": m.role,
                "avatar_url": user_map[m.user_id].avatar_url
                if m.user_id in user_map
                else None,
                "joined_at": m.joined_at.isoformat() if m.joined_at else None,
            }
            for m in members
            if m.user_id in user_map
        ]
    except Exception as exc:
        logger.warning("Could not fetch workspace members: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Fallback reply
# ---------------------------------------------------------------------------


def _fallback_reply(message: str, context: str) -> str:
    """Deterministic fallback when the LLM is unreachable."""
    if context:
        return (
            f"Based on the knowledge base:\n\n{context[:600]}...\n\n"
            "(Note: AI model is currently offline. Showing retrieved context only.)"
        )
    keywords = message.lower()
    if any(k in keywords for k in ["deploy", "cloud run", "pipeline"]):
        return "For deployment: use `gcloud run deploy karkhana --image gcr.io/PROJECT/karkhana:latest`. Set GEMINI_API_KEY, DATABASE_URL, and JWT_SECRET as Cloud Run secrets."
    if any(k in keywords for k in ["rag", "vector", "embed", "search"]):
        return "RAG pipeline: ingest documents via POST /api/rag/ingest, then query via POST /api/rag/chat. Chunks live in Postgres (pgvector), scoped to your workspace, embedded with Gemini or Ollama nomic-embed-text."
    if any(k in keywords for k in ["auth", "login", "otp", "token"]):
        return "Auth: Email → 6-digit OTP (Resend) → JWT. Google OAuth via /api/auth/google. All tokens are HMAC-SHA256 signed with JWT_SECRET. Set GOOGLE_CLIENT_ID for SSO."
    return "I'm currently offline. Please check that Ollama is running (`ollama serve`) or that GEMINI_API_KEY is configured."
