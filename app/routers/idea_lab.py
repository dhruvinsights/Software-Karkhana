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

"""Idea Lab: codebase scans, brainstorm chats and idea evaluation.

Approving an idea is not here: that is the reviewers' decision, made through
``app/routers/idea_approvals.py``.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app import workspace_access as wa
from app.ai import chat
from app.ai.idea_agents import evaluate_idea_comprehensive, run_codebase_scan
from app.auth import CurrentUser
from app.models import Idea, IdeaChat, IdeaChatMessage, IdeaScan, Product

logger = logging.getLogger(__name__)
router = APIRouter(tags=["idea_lab"])
Session = Annotated[AsyncSession, Depends(db.get_session)]


@router.get("/api/ai/providers")
async def get_ai_providers(_: CurrentUser) -> list[dict[str, Any]]:
    """Returns available AI providers and their models."""
    provs = await chat.list_providers()
    return [
        {
            "id": p.id,
            "label": p.label,
            "available": p.available,
            "detail": p.detail,
            "models": p.models,
            "defaultModel": p.default_model,
        }
        for p in provs
    ]


# ── Idea Scans (Codebase Autonomous Ideation) ──────────────────────────────────


class IdeaScanPayload(BaseModel):
    """Which provider and repository an idea scan should use."""

    provider: str = "ollama"
    model: str | None = None
    repo_url: str | None = None


@router.post(
    "/api/products/{product_id}/idea-scans", status_code=status.HTTP_202_ACCEPTED
)
async def trigger_idea_scan(
    product_id: str,
    payload: IdeaScanPayload,
    session: Session,
    user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    """Starts autonomous multi-agent exploration of the product codebase."""
    try:
        prod_uuid = uuid.UUID(product_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid product ID.") from None

    product = await session.get(Product, prod_uuid)
    if not product or product.archived_at is not None:
        raise HTTPException(status_code=404, detail="Product not found.")

    if not product.workspace_id:
        raise HTTPException(status_code=400, detail="Product has no workspace.")

    ws = await wa.workspace_access(session, user, product.workspace_id)
    ws.require_write()

    repo_url = payload.repo_url or (
        product.settings.get("repositoryUrl")
        if isinstance(product.settings, dict)
        else None
    )
    if not repo_url or not str(repo_url).strip():
        raise HTTPException(
            status_code=400,
            detail="Repository URL is required for codebase scan. Set it in Product Setup.",
        )

    scan = IdeaScan(
        id=uuid.uuid4(),
        product_id=product.id,
        workspace_id=product.workspace_id,
        status="running",
        provider=payload.provider,
        model=payload.model or "default",
        repo_url=str(repo_url).strip(),
        started_by=user.id,
        stats={"totalIdeas": 0},
    )
    session.add(scan)
    await session.commit()

    # Schedule background execution
    background_tasks.add_task(
        run_codebase_scan,
        scan_id=scan.id,
        product_id=product.id,
        workspace_id=product.workspace_id,
        repo_url=scan.repo_url,
        provider=payload.provider,  # type: ignore
        model=payload.model,
        started_by_id=user.id,
    )

    return {
        "id": str(scan.id),
        "productId": str(scan.product_id),
        "status": scan.status,
        "repoUrl": scan.repo_url,
        "provider": scan.provider,
        "createdAt": scan.created_at.isoformat(),
    }


@router.get("/api/products/{product_id}/idea-scans")
async def list_idea_scans(
    product_id: str,
    session: Session,
    user: CurrentUser,
) -> list[dict[str, Any]]:
    """Lists past scans for a product."""
    try:
        prod_uuid = uuid.UUID(product_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid product ID.") from None

    product = await session.get(Product, prod_uuid)
    if not product or not product.workspace_id:
        raise HTTPException(status_code=404, detail="Product not found.")
    await wa.workspace_access(session, user, product.workspace_id)

    scans = (
        await session.scalars(
            select(IdeaScan)
            .where(IdeaScan.product_id == prod_uuid)
            .order_by(IdeaScan.created_at.desc())
        )
    ).all()

    return [
        {
            "id": str(s.id),
            "productId": str(s.product_id),
            "status": s.status,
            "provider": s.provider,
            "model": s.model,
            "repoUrl": s.repo_url,
            "stats": s.stats,
            "error": s.error,
            "createdAt": s.created_at.isoformat(),
            "finishedAt": s.finished_at.isoformat() if s.finished_at else None,
        }
        for s in scans
    ]


# ── Idea Chats (Multi-turn Brainstorming Sessions) ────────────────────────────


class IdeaChatCreatePayload(BaseModel):
    """A new brainstorm chat, optionally seeded with an idea."""

    title: str = "New Idea Brainstorm"
    provider: str = "ollama"
    model: str | None = None
    idea_id: str | None = None


class IdeaChatMessagePayload(BaseModel):
    """One user message and the provider that should answer it."""

    content: str
    provider: str | None = None
    model: str | None = None


@router.get("/api/products/{product_id}/idea-chats")
async def list_idea_chats(
    product_id: str,
    session: Session,
    user: CurrentUser,
) -> list[dict[str, Any]]:
    """Lists brainstorm chat sessions for current user in this product."""
    try:
        prod_uuid = uuid.UUID(product_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid product ID.") from None

    product = await session.get(Product, prod_uuid)
    if not product or not product.workspace_id:
        raise HTTPException(status_code=404, detail="Product not found.")
    await wa.workspace_access(session, user, product.workspace_id)

    chats = (
        await session.scalars(
            select(IdeaChat)
            .where(IdeaChat.product_id == prod_uuid, IdeaChat.user_id == user.id)
            .order_by(IdeaChat.updated_at.desc())
        )
    ).all()

    return [
        {
            "id": str(c.id),
            "productId": str(c.product_id),
            "ideaId": str(c.idea_id) if c.idea_id else None,
            "title": c.title,
            "provider": c.provider,
            "model": c.model,
            "createdAt": c.created_at.isoformat(),
            "updatedAt": c.updated_at.isoformat(),
        }
        for c in chats
    ]


@router.post(
    "/api/products/{product_id}/idea-chats", status_code=status.HTTP_201_CREATED
)
async def create_idea_chat(
    product_id: str,
    payload: IdeaChatCreatePayload,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Creates a new idea chat session, optionally seeded with an idea."""
    try:
        prod_uuid = uuid.UUID(product_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid product ID.") from None

    product = await session.get(Product, prod_uuid)
    if not product or not product.workspace_id:
        raise HTTPException(status_code=404, detail="Product not found.")
    await wa.workspace_access(session, user, product.workspace_id)

    idea_uuid = uuid.UUID(payload.idea_id) if payload.idea_id else None

    chat_session = IdeaChat(
        id=uuid.uuid4(),
        product_id=product.id,
        workspace_id=product.workspace_id,
        user_id=user.id,
        idea_id=idea_uuid,
        title=payload.title.strip() or "Brainstorming Session",
        provider=payload.provider,
        model=payload.model or "default",
    )
    session.add(chat_session)
    await session.commit()

    return {
        "id": str(chat_session.id),
        "productId": str(chat_session.product_id),
        "ideaId": str(chat_session.idea_id) if chat_session.idea_id else None,
        "title": chat_session.title,
        "provider": chat_session.provider,
        "model": chat_session.model,
        "createdAt": chat_session.created_at.isoformat(),
        "updatedAt": chat_session.updated_at.isoformat(),
    }


@router.get("/api/idea-chats/{chat_id}")
async def get_idea_chat(
    chat_id: str,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Fetches a chat session with full message history."""
    try:
        c_uuid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat ID.") from None

    chat_session = await session.get(IdeaChat, c_uuid)
    if not chat_session:
        raise HTTPException(status_code=404, detail="Chat not found.")
    await wa.workspace_access(session, user, chat_session.workspace_id)

    messages = (
        await session.scalars(
            select(IdeaChatMessage)
            .where(IdeaChatMessage.chat_id == c_uuid)
            .order_by(IdeaChatMessage.created_at.asc())
        )
    ).all()

    return {
        "id": str(chat_session.id),
        "productId": str(chat_session.product_id),
        "ideaId": str(chat_session.idea_id) if chat_session.idea_id else None,
        "title": chat_session.title,
        "provider": chat_session.provider,
        "model": chat_session.model,
        "createdAt": chat_session.created_at.isoformat(),
        "messages": [
            {
                "id": str(m.id),
                "role": m.role,
                "content": m.content,
                "thinking": m.thinking,
                "createdAt": m.created_at.isoformat(),
            }
            for m in messages
        ],
    }


@router.post("/api/idea-chats/{chat_id}/messages")
async def send_idea_chat_message(
    chat_id: str,
    payload: IdeaChatMessagePayload,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Appends user message and generates assistant response via chosen AI provider."""
    try:
        c_uuid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat ID.") from None

    chat_session = await session.get(IdeaChat, c_uuid)
    if not chat_session:
        raise HTTPException(status_code=404, detail="Chat not found.")
    await wa.workspace_access(session, user, chat_session.workspace_id)

    # Fetch product metadata for context
    product = await session.get(Product, chat_session.product_id)
    prod_name = product.name if product else "Product"
    prod_desc = product.description if product else ""

    # Record user message
    user_msg = IdeaChatMessage(
        id=uuid.uuid4(),
        chat_id=chat_session.id,
        role="user",
        content=payload.content.strip(),
    )
    session.add(user_msg)
    await session.flush()

    # Load recent conversation history
    past_messages = (
        await session.scalars(
            select(IdeaChatMessage)
            .where(IdeaChatMessage.chat_id == c_uuid)
            .order_by(IdeaChatMessage.created_at.asc())
        )
    ).all()

    dialog: list[dict[str, str]] = [
        {"role": m.role, "content": m.content} for m in past_messages
    ]

    provider = payload.provider or chat_session.provider
    model = payload.model or (
        chat_session.model if chat_session.model != "default" else None
    )

    system_prompt = f"""You are the Lead Autonomous Architect for {prod_name}.
Product Context: {prod_desc}

Engage in visionary, actionable, engineering-grounded brainstorming.
Help refine ideas, write specifications, identify risks, and plan architectures.
Format every response in rich Markdown: a short title, `##` section headers, bullet lists,
tables (for comparisons, risks, roadmaps, scoring), and fenced code blocks where relevant.
Bold key terms. Keep tone direct, sharp, and highly technical, but fully structured and readable."""

    # Stream or complete from provider
    thinking_chunks: list[str] = []
    text_chunks: list[str] = []

    try:
        async for event in chat.stream(
            provider,  # type: ignore
            dialog,
            system=system_prompt,
            model=model,
        ):
            if event["type"] == "thinking":
                thinking_chunks.append(event["delta"])
            elif event["type"] == "text":
                text_chunks.append(event["delta"])
    except Exception as exc:
        logger.exception("AI brainstorm stream failed: %s", exc)
        text_chunks = [f"*(AI response error: {exc})*"]

    assistant_msg = IdeaChatMessage(
        id=uuid.uuid4(),
        chat_id=chat_session.id,
        role="assistant",
        content="".join(text_chunks).strip(),
        thinking="".join(thinking_chunks).strip() or None,
    )
    session.add(assistant_msg)

    # Auto-update chat title on first turn
    if len(past_messages) <= 2:
        chat_session.title = payload.content[:40].strip() or chat_session.title

    chat_session.updated_at = dt.datetime.now(dt.UTC)
    session.add(chat_session)
    await session.commit()

    return {
        "id": str(assistant_msg.id),
        "role": assistant_msg.role,
        "content": assistant_msg.content,
        "thinking": assistant_msg.thinking,
        "createdAt": assistant_msg.created_at.isoformat(),
        "chatTitle": chat_session.title,
    }


# ── Idea Evaluation & Reviews ──────────────────────────────────────────────────


@router.post("/api/ideas/{idea_id}/evaluate")
async def evaluate_idea_endpoint(
    idea_id: str,
    session: Session,
    user: CurrentUser,
    provider: str = "ollama",
    model: str | None = None,
) -> dict[str, Any]:
    """Generates an executive evaluation report for an Idea prior to reviewer sign-off."""
    try:
        idea_uuid = uuid.UUID(idea_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid idea ID.") from None

    idea = await session.get(Idea, idea_uuid)
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found.")

    product = await session.get(Product, idea.product_id) if idea.product_id else None
    if idea.workspace_id:
        ws = await wa.workspace_access(session, user, idea.workspace_id)
        ws.require_write()

    report = await evaluate_idea_comprehensive(
        idea, product, provider=provider, model=model
    )  # type: ignore
    idea.review_report = report
    session.add(idea)
    await session.commit()

    return {
        "ideaId": str(idea.id),
        "report": report,
    }
