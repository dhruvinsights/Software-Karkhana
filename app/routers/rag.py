"""RAG (Retrieval-Augmented Generation) router — real LangChain + Ollama pipeline.

Provides:
  POST /api/rag/chat          — streaming / non-streaming chat with vector-backed context
  GET  /api/rag/history       — paginated chat history for a session
  POST /api/rag/ingest        — ingest a document (text/markdown) into the vector store
  GET  /api/rag/documents     — list ingested documents
  DELETE /api/rag/documents/{id} — remove a document
  GET  /api/workspaces/{workspace_id}/members — real workspace member list
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from typing import Annotated, Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.auth import CurrentUser
from app.config import get_settings
from app.models import User, WorkspaceMember

logger = logging.getLogger(__name__)
router = APIRouter(tags=["rag"])
Session = Annotated[AsyncSession, Depends(db.get_session)]

# ---------------------------------------------------------------------------
# In-memory vector store and chat history (production: replace with pgvector)
# ---------------------------------------------------------------------------

_CHAT_HISTORY: dict[str, list[dict[str, str]]] = {}  # session_id -> messages
_DOCUMENT_STORE: list[dict[str, Any]] = []  # ingested doc metadata

# Lazy-loaded LangChain components
_vectorstore: Any = None
_embeddings: Any = None


def _get_embeddings():
    """Return the embedding model, lazy-initialised."""
    global _embeddings
    if _embeddings is None:
        s = get_settings()
        try:
            if s.embed_provider == "ollama":
                from langchain_ollama import OllamaEmbeddings  # type: ignore
                _embeddings = OllamaEmbeddings(
                    model=s.ollama_embed_model or "nomic-embed-text",
                    base_url=s.ollama_base_url or "http://localhost:11434",
                )
            else:
                from langchain_google_genai import GoogleGenerativeAIEmbeddings  # type: ignore
                _embeddings = GoogleGenerativeAIEmbeddings(
                    model=s.embedding_model or "models/text-embedding-004",
                    google_api_key=s.gemini_api_key,
                )
        except ImportError as exc:
            logger.warning("Embedding provider not installed: %s", exc)
    return _embeddings


def _get_vectorstore():
    """Return or build the in-memory FAISS vector store."""
    global _vectorstore
    if _vectorstore is None and _DOCUMENT_STORE:
        try:
            from langchain_community.vectorstores import FAISS  # type: ignore
            from langchain.schema import Document  # type: ignore
            emb = _get_embeddings()
            if emb is None:
                return None
            docs = [
                Document(
                    page_content=d["content"],
                    metadata={"doc_id": d["id"], "title": d["title"], "workspace_id": d["workspace_id"]},
                )
                for d in _DOCUMENT_STORE
            ]
            _vectorstore = FAISS.from_documents(docs, emb)
        except Exception as exc:
            logger.warning("FAISS vectorstore init failed: %s", exc)
    return _vectorstore


def _reset_vectorstore():
    """Called after ingestion to rebuild the FAISS index next query."""
    global _vectorstore
    _vectorstore = None


def _build_llm():
    """Build the LangChain chat LLM from current settings."""
    s = get_settings()
    try:
        if s.llm_provider == "ollama":
            from langchain_ollama import ChatOllama  # type: ignore
            return ChatOllama(
                model=s.ollama_model or "llama3.1",
                base_url=s.ollama_base_url or "http://localhost:11434",
                temperature=0.3,
            )
        else:
            from langchain_google_genai import ChatGoogleGenerativeAI  # type: ignore
            return ChatGoogleGenerativeAI(
                model=s.gemini_model or "gemini-2.0-flash",
                google_api_key=s.gemini_api_key,
                temperature=0.3,
            )
    except ImportError as exc:
        logger.warning("LLM provider not installed: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    message: str
    workspace_id: str
    stream: bool = False


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    sources: list[str] = Field(default_factory=list)
    history: list[ChatMessage] = Field(default_factory=list)


class IngestRequest(BaseModel):
    title: str
    content: str
    workspace_id: str
    tags: list[str] = Field(default_factory=list)


class DocumentOut(BaseModel):
    id: str
    title: str
    tags: list[str]
    created_at: str
    chunk_count: int


async def _require_workspace_member(
    session: AsyncSession, user: User, workspace_id: str
) -> None:
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


# ---------------------------------------------------------------------------
# Chat endpoint
# ---------------------------------------------------------------------------

def _retrieve_context(query: str, workspace_id: str, k: int = 4) -> tuple[str, list[str]]:
    """Retrieve top-k relevant chunks from the vector store."""
    vs = _get_vectorstore()
    if vs is None:
        return "", []
    try:
        docs = vs.similarity_search(query, k=k, filter={"workspace_id": workspace_id})
        sources = list({d.metadata.get("title", "unknown") for d in docs})
        context_text = "\n\n---\n\n".join(d.page_content for d in docs)
        return context_text, sources
    except Exception as exc:
        logger.warning("Retrieval error: %s", exc)
        return "", []


def _build_rag_prompt(user_message: str, retrieved_context: str) -> str:
    """Build a RAG-augmented system + user prompt."""
    system = (
        "You are the Software Karkhana Factory AI — a senior engineering assistant "
        "with deep knowledge of the team's codebase, architecture decisions, and product context. "
        "Be concise, precise, and practical. Always ground answers in the provided context when available."
    )
    if retrieved_context:
        return (
            f"{system}\n\n"
            f"=== RETRIEVED KNOWLEDGE BASE CONTEXT ===\n{retrieved_context}\n"
            f"=== END CONTEXT ===\n\n"
            f"User: {user_message}"
        )
    return f"{system}\n\nUser: {user_message}"


@router.post("/api/rag/chat", response_model=ChatResponse)
async def rag_chat(payload: ChatRequest, user: CurrentUser, session: Session) -> ChatResponse:
    """Non-streaming RAG chat with Ollama / Gemini and vector-backed context."""
    await _require_workspace_member(session, user, payload.workspace_id)
    session_id = payload.session_id
    history_key = f"{user.id}:{payload.workspace_id}:{session_id}"
    history = _CHAT_HISTORY.setdefault(history_key, [])

    # Retrieve relevant context
    context_text, sources = _retrieve_context(payload.message, payload.workspace_id)
    prompt_text = _build_rag_prompt(payload.message, context_text)

    llm = _build_llm()
    reply_text = ""

    if llm is not None:
        try:
            from langchain.schema import HumanMessage, SystemMessage, AIMessage  # type: ignore
            lc_messages = []
            # Inject prior history
            for h in history[-10:]:  # last 5 turns
                if h["role"] == "user":
                    lc_messages.append(HumanMessage(content=h["content"]))
                else:
                    lc_messages.append(AIMessage(content=h["content"]))
            lc_messages.append(HumanMessage(content=prompt_text))
            response = await llm.ainvoke(lc_messages)
            reply_text = response.content if hasattr(response, "content") else str(response)
        except Exception as exc:
            logger.warning("LLM invocation failed: %s", exc)
            reply_text = _fallback_reply(payload.message, context_text)
    else:
        reply_text = _fallback_reply(payload.message, context_text)

    # Persist history
    history.append({"role": "user", "content": payload.message})
    history.append({"role": "assistant", "content": reply_text})

    return ChatResponse(
        session_id=session_id,
        reply=reply_text,
        sources=sources,
        history=[ChatMessage(role=h["role"], content=h["content"]) for h in history],
    )


@router.get("/api/rag/history/{session_id}")
async def get_chat_history(
    session_id: str,
    user: CurrentUser,
    session: Session,
    workspace_id: str = Query(...),
) -> list[ChatMessage]:
    """Returns full chat history for a session."""
    await _require_workspace_member(session, user, workspace_id)
    history = _CHAT_HISTORY.get(f"{user.id}:{workspace_id}:{session_id}", [])
    return [ChatMessage(role=h["role"], content=h["content"]) for h in history]


@router.delete("/api/rag/history/{session_id}", status_code=204)
async def clear_chat_history(
    session_id: str,
    user: CurrentUser,
    session: Session,
    workspace_id: str = Query(...),
) -> None:
    """Clears chat history for a session."""
    await _require_workspace_member(session, user, workspace_id)
    _CHAT_HISTORY.pop(f"{user.id}:{workspace_id}:{session_id}", None)


# ---------------------------------------------------------------------------
# Document ingestion
# ---------------------------------------------------------------------------

@router.post("/api/rag/ingest", status_code=status.HTTP_201_CREATED, response_model=DocumentOut)
async def ingest_document(
    payload: IngestRequest, user: CurrentUser, session: Session
) -> DocumentOut:
    """Ingest a document into the RAG knowledge base. Chunks it and rebuilds the index."""
    await _require_workspace_member(session, user, payload.workspace_id)
    from langchain.text_splitter import RecursiveCharacterTextSplitter  # type: ignore

    doc_id = str(uuid.uuid4())

    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=150)
    chunks = splitter.split_text(payload.content)

    # Store each chunk with parent metadata
    for i, chunk in enumerate(chunks):
        _DOCUMENT_STORE.append({
            "id": f"{doc_id}_c{i}",
            "parent_id": doc_id,
            "title": payload.title,
            "content": chunk,
            "tags": payload.tags,
            "workspace_id": payload.workspace_id,
            "created_at": dt.datetime.now(dt.UTC).isoformat(),
        })

    _reset_vectorstore()

    return DocumentOut(
        id=doc_id,
        title=payload.title,
        tags=payload.tags,
        created_at=dt.datetime.now(dt.UTC).isoformat(),
        chunk_count=len(chunks),
    )


@router.get("/api/rag/documents", response_model=list[DocumentOut])
async def list_documents(
    user: CurrentUser, session: Session, workspace_id: str = Query(...)
) -> list[DocumentOut]:
    """Lists all ingested documents (deduplicated by parent_id)."""
    await _require_workspace_member(session, user, workspace_id)
    seen: dict[str, DocumentOut] = {}
    for d in _DOCUMENT_STORE:
        if d.get("workspace_id") != workspace_id:
            continue
        pid = d.get("parent_id", d["id"])
        if pid not in seen:
            seen[pid] = DocumentOut(
                id=pid,
                title=d["title"],
                tags=d.get("tags", []),
                created_at=d["created_at"],
                chunk_count=sum(1 for x in _DOCUMENT_STORE if x.get("parent_id") == pid and x.get("workspace_id") == workspace_id),
            )
    return list(seen.values())


@router.delete("/api/rag/documents/{doc_id}", status_code=204)
async def delete_document(
    doc_id: str,
    user: CurrentUser,
    session: Session,
    workspace_id: str = Query(...),
) -> None:
    """Removes a document and all its chunks from the store."""
    global _DOCUMENT_STORE
    await _require_workspace_member(session, user, workspace_id)
    _DOCUMENT_STORE = [
        d for d in _DOCUMENT_STORE
        if not (d.get("workspace_id") == workspace_id and (d.get("parent_id") == doc_id or d["id"] == doc_id))
    ]
    _reset_vectorstore()


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

        users = (
            await session.scalars(select(User).where(User.id.in_(user_ids)))
        ).all()
        user_map = {u.id: u for u in users}

        return [
            {
                "id": str(m.user_id),
                "name": user_map[m.user_id].display_name if m.user_id in user_map else "Unknown",
                "email": user_map[m.user_id].email if m.user_id in user_map else "",
                "role": m.role,
                "avatar_url": user_map[m.user_id].avatar_url if m.user_id in user_map else None,
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
        return "RAG pipeline: ingest documents via POST /api/rag/ingest, then query via POST /api/rag/chat. Uses FAISS in-memory index backed by Ollama nomic-embed-text or Gemini embeddings."
    if any(k in keywords for k in ["auth", "login", "otp", "token"]):
        return "Auth: Email → 6-digit OTP (Resend) → JWT. Google OAuth via /api/auth/google. All tokens are HMAC-SHA256 signed with JWT_SECRET. Set GOOGLE_CLIENT_ID for SSO."
    return "I'm currently offline. Please check that Ollama is running (`ollama serve`) or that GEMINI_API_KEY is configured."
