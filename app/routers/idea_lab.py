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
import json
import logging
import re
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db, reports
from app import workspace_access as wa
from app.ai import chat, llm
from app.ai.idea_agents import run_codebase_scan
from app.auth import CurrentUser
from app.config import get_settings
from app.models import Idea, IdeaChat, IdeaChatMessage, IdeaScan, Product, User
from app.services import idea_report, repo_context

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
    """Optionally a repository URL to scan instead of the product's own."""

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

    if (product.settings or {}).get("repositoryUrl") != str(repo_url).strip():
        product.settings = {**(product.settings or {}), "repositoryUrl": str(repo_url).strip()}
    scan = IdeaScan(
        id=uuid.uuid4(),
        product_id=product.id,
        workspace_id=product.workspace_id,
        status="running",
        provider=get_settings().llm_provider,
        model=llm.chat_model_name(),
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
    # Ideas the user attached to this message; their full details go in the prompt.
    idea_ids: list[str] = []


# Room for repository code in the brainstorm prompt (local models have small windows).
_CHAT_REPO_BUDGET = 40_000


def _idea_block(idea: Idea, *, full: bool) -> str:
    head = f"- [{idea.status}] {idea.title} (complexity {idea.complexity})"
    if not full:
        return head
    report = (idea.review_report or {}).get("report") if idea.review_report else None
    lines = [
        head,
        f"  Problem: {idea.problem_statement}",
        f"  Expected value: {idea.expected_value}",
        f"  Target user: {idea.target_user}",
        f"  Tags: {', '.join(idea.tags or [])}",
    ]
    if idea.evidence:
        lines.append(f"  Evidence files: {', '.join(map(str, idea.evidence))}")
    if idea.assessment:
        lines.append(f"  Feasibility assessment: {json.dumps(idea.assessment)[:3000]}")
    if report:
        lines.append(f"  Evaluation report: {json.dumps(report)[:6000]}")
    return "\n".join(lines)


async def _chat_context(
    session: AsyncSession, product: Product | None, chat_session: IdeaChat, attached: list[uuid.UUID]
) -> str:
    """Everything the brainstorm should know: the product setup, its ideas and its code."""
    if product is None:
        return "PRODUCT: (unknown)"
    st = product.settings or {}
    parts = [
        f"PRODUCT: {product.name} ({product.code}) · domain {product.domain or 'n/a'}",
        f"Description: {product.description}",
        f"Problem it solves: {st.get('problemStatement') or 'n/a'}",
        f"Target users: {st.get('targetUsers') or 'n/a'}",
        f"Tech stack: {', '.join(st.get('techStack') or []) or 'n/a'}",
        f"Key features: {'; '.join(st.get('keyFeatures') or []) or 'n/a'}",
        f"Constraints: {'; '.join(st.get('constraints') or []) or 'n/a'}",
        f"Repository: {st.get('repositoryUrl') or 'none connected'}",
    ]
    ideas = list(
        (
            await session.scalars(
                select(Idea).where(Idea.product_id == product.id).order_by(Idea.created_at.desc()).limit(40)
            )
        ).all()
    )
    focus = set(attached) | ({chat_session.idea_id} if chat_session.idea_id else set())
    focused = [i for i in ideas if i.id in focus]
    # Attached ideas from outside the newest 40 still count.
    missing = focus - {i.id for i in focused}
    for iid in missing:
        extra = await session.get(Idea, iid)
        if extra is not None and extra.product_id == product.id:
            focused.append(extra)
    if focused:
        parts.append("\nIDEAS THE USER IS DISCUSSING (full detail):")
        parts.extend(_idea_block(i, full=True) for i in focused)
    others = [i for i in ideas if i.id not in focus]
    if others:
        parts.append("\nOTHER IDEAS ALREADY PROPOSED FOR THIS PRODUCT (avoid duplicates):")
        parts.extend(_idea_block(i, full=False) for i in others)
    snapshot = await repo_context.latest(session, product.id)
    if snapshot is not None:
        parts.append("\n" + repo_context.render(snapshot, _CHAT_REPO_BUDGET))
    return "\n".join(parts)


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

    product = await session.get(Product, chat_session.product_id)
    prod_name = product.name if product else "Product"
    attached: list[uuid.UUID] = []
    for raw in payload.idea_ids[:10]:
        try:
            attached.append(uuid.UUID(raw))
        except ValueError:
            continue
    context = await _chat_context(session, product, chat_session, attached)

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
Use the product context below as the truth about the product, its ideas and its code.
When the user attaches ideas, build on them and say how they fit with the others.

<product_context>
{context}
</product_context>

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


# ── Idea Evaluation Report ─────────────────────────────────────────────────────


async def _idea_for(
    session: AsyncSession, user: Any, idea_id: uuid.UUID, *, write: bool
) -> Idea:
    idea = await session.get(Idea, idea_id)
    if idea is None or idea.workspace_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Idea not found.")
    ws = await wa.workspace_access(session, user, idea.workspace_id)
    if write:
        ws.require_write()
    return idea


@router.post("/api/ideas/{idea_id}/evaluate", status_code=status.HTTP_202_ACCEPTED)
async def evaluate_idea_endpoint(
    idea_id: uuid.UUID,
    session: Session,
    user: CurrentUser,
    background: BackgroundTasks,
) -> dict[str, Any]:
    """Starts the evaluation report; ``workspace_sync: ideas`` fires when it is done."""
    idea = await _idea_for(session, user, idea_id, write=True)
    if (idea.review_report or {}).get("status") == "running":
        raise HTTPException(status.HTTP_409_CONFLICT, "A report is already being written.")
    idea.review_report = {"status": "running", "startedAt": dt.datetime.now(dt.UTC).isoformat()}
    await session.commit()
    background.add_task(idea_report.run, idea.id, user.id)
    return {"ideaId": str(idea.id), "status": "running"}


async def _report_html(session: AsyncSession, idea: Idea) -> str:
    stored = idea.review_report or {}
    if stored.get("status") != "ready":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This idea has no finished report yet.")
    product = await session.get(Product, idea.product_id) if idea.product_id else None
    author = await session.get(User, idea.author_id) if idea.author_id else None
    return reports.idea_report_html(
        idea=idea,
        product=product,
        author=(author.display_name or author.email) if author else None,
        stored=stored,
    )


@router.get("/api/ideas/{idea_id}/report.html", response_class=HTMLResponse)
async def idea_report_page(idea_id: uuid.UUID, session: Session, user: CurrentUser) -> HTMLResponse:
    """The finished report as a printable HTML page (for the in-app preview)."""
    idea = await _idea_for(session, user, idea_id, write=False)
    return HTMLResponse(await _report_html(session, idea))


@router.get("/api/ideas/{idea_id}/report.pdf")
async def idea_report_pdf(idea_id: uuid.UUID, session: Session, user: CurrentUser) -> Response:
    """The finished report as an A4 PDF."""
    idea = await _idea_for(session, user, idea_id, write=False)
    pdf = await reports.to_pdf(await _report_html(session, idea), title=idea.title)
    filename = re.sub(r"[^A-Za-z0-9]+", "-", idea.title).strip("-")[:80] or "idea"
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}-evaluation.pdf"'},
    )
