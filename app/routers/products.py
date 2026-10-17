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

"""Product catalog and feature idea management endpoints."""

from __future__ import annotations

import datetime as dt
import logging
import re
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, db, idea_flow, ledger
from app import workspace_access as wa
from app.ai import llm
from app.ai.errors import ModelError
from app.auth import CurrentUser
from app.models import (
    ActivityEvent,
    Idea,
    Product,
    ProductDocument,
    ProductDocumentChunk,
    Project,
    WorkspaceMember,
)
from app.schemas import (
    DocumentExtractRequest,
    DocumentExtractResponse,
    ExtractedProductSpec,
)
from app.services import idea_scope
from app.services.realtime import notify_activity, notify_workspace

logger = logging.getLogger(__name__)
router = APIRouter(tags=["products_and_ideas"])
Session = Annotated[AsyncSession, Depends(db.get_session)]


class ProductCreatePayload(BaseModel):
    """Request body for creating a product (the full setup screen)."""

    name: str
    code: str | None = None
    domain: str = "Cloud Services"
    description: str = ""
    workspace_id: str | None = None
    problem_statement: str = ""
    target_users: str = ""
    tech_stack: list[str] = []
    repository_url: str = ""
    key_features: list[str] = []
    constraints: list[str] = []
    # Station ids this product's projects use (each becomes a team space per project).
    team_spaces: list[str] = []
    # Workspace members who review ideas for this product.
    reviewer_ids: list[uuid.UUID] = []
    # The sizing shown on the setup screen (POST /api/products/analyse). When
    # missing, the product is sized in the background after it is created.
    profile: idea_scope.ProductProfile | None = None


# Station ids from app.idea_flow, minus "product" (the PM side is always there).
TEAM_SPACES = tuple(s for s in idea_flow.ALL_STATIONS if s != "product")


def _product_dict(p: Product) -> dict[str, Any]:
    st = p.settings or {}
    return {
        "id": str(p.id),
        "workspaceId": str(p.workspace_id) if p.workspace_id else None,
        "name": p.name,
        "code": p.code,
        "domain": p.domain,
        "description": p.description,
        "status": p.status,
        "problemStatement": st.get("problemStatement", ""),
        "targetUsers": st.get("targetUsers", ""),
        "techStack": st.get("techStack", []),
        "repositoryUrl": st.get("repositoryUrl", ""),
        "keyFeatures": st.get("keyFeatures", []),
        "constraints": st.get("constraints", []),
        "teamSpaces": wa.normalize_stations(st.get("teamSpaces")) or list(TEAM_SPACES),
        "reviewerIds": st.get("reviewerIds", []),
        "profile": st.get("profile"),
        "createdAt": (p.created_at or dt.datetime.now(dt.UTC)).isoformat(),
    }


class IdeaCreatePayload(BaseModel):
    """Request body for submitting an idea."""

    title: str
    problem_statement: str
    target_user: str = "Enterprise Users"
    expected_value: str = ""
    product_id: str | None = None
    workspace_id: str | None = None
    complexity: str = "Medium"
    tags: list[str] = Field(default_factory=list)
    # A person may propose a whole project directly; small products only take features.
    scope: Literal["feature", "project"] = "feature"


class IdeaUpdatePayload(BaseModel):
    """Request body for updating an idea's fields or status."""

    title: str | None = None
    problem_statement: str | None = None
    expected_value: str | None = None
    status: str | None = None
    complexity: str | None = None
    tags: list[str] | None = None
    assessment: dict[str, Any] | None = None


async def _scope(session: AsyncSession, user: Any, workspace_id: str | None, header: str | None) -> uuid.UUID:
    """The workspace a list call is about: the query, else the header, else the caller's default."""
    raw = workspace_id or header
    try:
        ws_uuid = uuid.UUID(raw) if raw else await wa.default_workspace_id(session, user)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid workspace id") from None
    await wa.workspace_access(session, user, ws_uuid)
    return ws_uuid


@router.get("/api/products")
async def list_products(
    session: Session,
    user: CurrentUser,
    workspace_id: str | None = None,
    x_workspace_id: Annotated[str | None, Header()] = None,
) -> list[dict[str, Any]]:
    """Lists the products of one workspace the caller belongs to (archived ones are hidden)."""
    ws_uuid = await _scope(session, user, workspace_id, x_workspace_id)
    stmt = (
        select(Product)
        .where(Product.workspace_id == ws_uuid, Product.archived_at.is_(None))
        .order_by(Product.created_at.desc())
    )
    return [_product_dict(p) for p in (await session.scalars(stmt)).all()]


@router.post("/api/products", status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreatePayload,
    background: BackgroundTasks,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Creates a product in a workspace. Only the workspace owner and admins may."""
    code = payload.code or re.sub(r"[^A-Za-z0-9]", "", payload.name).upper()[:6] or "PROD"
    try:
        ws_requested = uuid.UUID(payload.workspace_id) if payload.workspace_id else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid workspace id") from None
    ws_uuid = await access.resolve_workspace(session, user, ws_requested)
    (await wa.workspace_access(session, user, ws_uuid)).require_admin()

    team_spaces = [t for t in TEAM_SPACES if t in set(payload.team_spaces)] if payload.team_spaces else list(TEAM_SPACES)
    wanted_reviewers = set(payload.reviewer_ids)
    reviewer_ids = (
        set(
            (
                await session.scalars(
                    select(WorkspaceMember.user_id).where(
                        WorkspaceMember.workspace_id == ws_uuid, WorkspaceMember.user_id.in_(wanted_reviewers)
                    )
                )
            ).all()
        )
        if wanted_reviewers
        else set()
    )
    if reviewer_ids != wanted_reviewers:
        raise HTTPException(status_code=400, detail="Every reviewer must be a member of this workspace.")

    product = Product(
        id=uuid.uuid4(),
        workspace_id=ws_uuid,
        name=payload.name.strip(),
        code=code,
        domain=payload.domain.strip(),
        description=payload.description.strip(),
        status="active",
        created_by=user.id,
        settings={
            "problemStatement": payload.problem_statement.strip(),
            "targetUsers": payload.target_users.strip(),
            "techStack": [t.strip() for t in payload.tech_stack if t.strip()],
            "repositoryUrl": payload.repository_url.strip(),
            "keyFeatures": [f.strip() for f in payload.key_features if f.strip()],
            "constraints": [c.strip() for c in payload.constraints if c.strip()],
            "teamSpaces": team_spaces,
            "reviewerIds": [str(r) for r in reviewer_ids],
            **(
                {
                    "profile": {
                        **payload.profile.model_dump(),
                        # Confirmed (or corrected) by the admin on the setup screen.
                        "source": "setup",
                        "analysedAt": dt.datetime.now(dt.UTC).isoformat(),
                    }
                }
                if payload.profile
                else {}
            ),
        },
    )
    session.add(product)
    await session.flush()

    # Reviewers get the reviewer access level (admins and the owner keep theirs) and a notification.
    if reviewer_ids:
        members = (
            await session.scalars(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == ws_uuid, WorkspaceMember.user_id.in_(reviewer_ids)
                )
            )
        ).all()
        for member in members:
            # Members become reviewers; guides keep their wider read access.
            if member.access == "member" and not member.is_owner:
                member.access = "reviewer"
            session.add(
                ActivityEvent(
                    workspace_id=ws_uuid,
                    actor_id=user.id,
                    recipient_id=member.user_id,
                    type="reviewer_added",
                    summary=f"{user.display_name} added you as a reviewer for {product.name}",
                    target_type="product",
                    target_id=str(product.id),
                )
            )

    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="product.created",
        subject_type="product",
        subject_id=product.id,
        payload={"name": product.name, "code": product.code, "domain": product.domain},
    )
    await session.commit()
    await notify_workspace(ws_uuid, "products")
    await notify_activity(ws_uuid, reviewer_ids)
    if payload.profile is None:
        background.add_task(idea_scope.profile_in_background, product.id)
    return _product_dict(product)


@router.delete("/api/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(product_id: uuid.UUID, session: Session, user: CurrentUser) -> None:
    """Archives a product and its projects for everyone. Workspace owner/admins only."""
    product = await session.get(Product, product_id)
    if product is None or product.archived_at is not None or product.workspace_id is None:
        raise HTTPException(status_code=404, detail="Product not found")
    try:
        ws = await wa.workspace_access(session, user, product.workspace_id)
    except HTTPException:
        raise HTTPException(status_code=404, detail="Product not found") from None
    ws.require_admin()
    now = dt.datetime.now(dt.UTC)
    product.archived_at, product.archived_by = now, user.id
    for project in (
        await session.scalars(select(Project).where(Project.product_id == product.id, Project.archived_at.is_(None)))
    ).all():
        project.archived_at, project.archived_by = now, user.id
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="product.archived",
        subject_type="product",
        subject_id=product.id,
        payload={"name": product.name},
    )
    await session.commit()
    await notify_workspace(product.workspace_id, "products")
    await notify_workspace(product.workspace_id, "projects")


async def _idea_workspace(session: AsyncSession, user: Any, idea: Idea) -> wa.WorkspaceAccess | None:
    """The caller's access to the idea's workspace; 404 if they are not a member."""
    if idea.workspace_id is None:
        return None
    try:
        return await wa.workspace_access(session, user, idea.workspace_id)
    except HTTPException:
        raise HTTPException(status_code=404, detail="Idea not found.") from None


def _idea_dict(i: Idea, user: Any) -> dict[str, Any]:
    return {
        "id": str(i.id),
        "productId": str(i.product_id) if i.product_id else None,
        "workspaceId": str(i.workspace_id) if i.workspace_id else None,
        "title": i.title,
        "problemStatement": i.problem_statement,
        "targetUser": i.target_user,
        "expectedValue": i.expected_value,
        "authorId": str(i.author_id) if i.author_id else str(user.id),
        "status": i.status,
        "complexity": i.complexity,
        "tags": i.tags or [],
        "assessment": i.assessment,
        "source": i.source,
        "evidence": i.evidence or [],
        "reviewReport": i.review_report,
        "promotedProjectId": str(i.project_id) if i.project_id else None,
        "scope": i.scope or idea_scope.FEATURE,
        "parentId": str(i.parent_id) if i.parent_id else None,
        "delivery": i.delivery,
        "createdAt": i.created_at.isoformat(),
        "updatedAt": i.updated_at.isoformat() if i.updated_at else i.created_at.isoformat(),
    }


@router.get("/api/ideas")
async def list_ideas(
    session: Session,
    user: CurrentUser,
    product_id: str | None = None,
    workspace_id: str | None = None,
    x_workspace_id: Annotated[str | None, Header()] = None,
) -> list[dict[str, Any]]:
    """Lists the ideas of one workspace the caller belongs to."""
    ws_uuid = await _scope(session, user, workspace_id, x_workspace_id)
    stmt = select(Idea).where(Idea.workspace_id == ws_uuid).order_by(Idea.created_at.desc())
    if product_id:
        try:
            stmt = stmt.where(Idea.product_id == uuid.UUID(product_id))
        except ValueError:
            pass
    return [_idea_dict(i, user) for i in (await session.scalars(stmt)).all()]


@router.post("/api/ideas", status_code=status.HTTP_201_CREATED)
async def create_idea(
    payload: IdeaCreatePayload,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Creates a new feature idea for validation. Guides and reviewers are read-only."""
    prod_uuid = uuid.UUID(payload.product_id) if payload.product_id else None
    ws_requested = uuid.UUID(payload.workspace_id) if payload.workspace_id else None
    # Ideas live in a workspace the author belongs to, so approvals and
    # promotion are governed by that workspace's roles.
    ws_uuid = await access.resolve_workspace(session, user, ws_requested)
    await wa.forbid_read_only(session, user, ws_uuid)
    product = None
    if prod_uuid:
        product = await session.get(Product, prod_uuid)
        if product is None or product.workspace_id != ws_uuid or product.archived_at is not None:
            raise HTTPException(status_code=400, detail="That product is not in this workspace.")
    if payload.scope == idea_scope.PROJECT and (idea_scope.profile_of(product) or {}).get("size") == "small":
        raise HTTPException(
            status_code=422,
            detail=f"{product.name if product else 'This product'} is a small product: propose features, "
            "and they are added to its project.",
        )

    idea = Idea(
        id=uuid.uuid4(),
        product_id=prod_uuid,
        workspace_id=ws_uuid,
        title=payload.title.strip(),
        problem_statement=payload.problem_statement.strip(),
        target_user=payload.target_user.strip(),
        expected_value=payload.expected_value.strip(),
        author_id=user.id,
        status=idea_flow.IDEA_DRAFT,
        complexity=payload.complexity,
        tags=payload.tags,
        assessment=None,
        scope=payload.scope,
    )
    session.add(idea)
    await session.flush()

    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="idea.submitted",
        subject_type="idea",
        subject_id=idea.id,
        payload={"title": idea.title, "target_user": idea.target_user},
    )
    idea.created_at = idea.created_at or dt.datetime.now(dt.UTC)
    return _idea_dict(idea, user)


# Statuses that only the approval flow (app/routers/idea_approvals.py) may set.
_FLOW_STATUSES = (
    idea_flow.IDEA_PENDING,
    idea_flow.IDEA_APPROVED,
    idea_flow.IDEA_REJECTED,
    idea_flow.IDEA_PROMOTED,
)


@router.put("/api/ideas/{idea_id}")
async def update_idea(
    idea_id: str,
    payload: IdeaUpdatePayload,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Edits an idea. Approval statuses can only change through the approval flow."""
    try:
        idea_uuid = uuid.UUID(idea_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid idea ID format.") from None

    idea = await session.scalar(select(Idea).where(Idea.id == idea_uuid))
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found.")
    ws = await _idea_workspace(session, user, idea)
    if ws is not None:
        ws.require_write()
    if payload.status in _FLOW_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="Request approval from reviewers instead; an idea's approval status is set by their decisions.",
        )

    if payload.title is not None:
        idea.title = payload.title.strip()
    if payload.problem_statement is not None:
        idea.problem_statement = payload.problem_statement.strip()
    if payload.expected_value is not None:
        idea.expected_value = payload.expected_value.strip()
    if payload.status is not None:
        idea.status = payload.status
    if payload.complexity is not None:
        idea.complexity = payload.complexity
    if payload.tags is not None:
        idea.tags = payload.tags
    if payload.assessment is not None:
        idea.assessment = payload.assessment

    session.add(idea)
    await session.flush()

    return {
        "id": str(idea.id),
        "productId": str(idea.product_id) if idea.product_id else None,
        "title": idea.title,
        "problemStatement": idea.problem_statement,
        "status": idea.status,
        "assessment": idea.assessment,
    }


def _chunk_text(text: str, chunk_size: int = 800, overlap: int = 150) -> list[str]:
    """Splits document text into overlapping chunks for semantic pgvector retrieval."""
    if not text or not text.strip():
        return []
    cleaned = text.strip()
    if len(cleaned) <= chunk_size:
        return [cleaned]

    chunks: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(start + chunk_size, len(cleaned))
        if end < len(cleaned):
            break_point = max(
                cleaned.rfind("\n", start + overlap, end),
                cleaned.rfind(". ", start + overlap, end),
            )
            if break_point > start + overlap:
                end = break_point + (1 if cleaned[break_point] == "\n" else 2)
        chunk = cleaned[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = max(end - overlap, start + 1)
        if end >= len(cleaned):
            break
    return chunks


def _fallback_extract_spec(text: str, filename: str) -> ExtractedProductSpec:
    """Heuristic structured spec extractor for documents when LLM provider is offline."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    first_title = lines[0] if lines else filename.replace(".md", "").replace(".txt", "").replace(".json", "").replace("_", " ").title()
    if first_title.startswith("#"):
        first_title = first_title.lstrip("#").strip()

    name = first_title[:80] or "Autonomous Enterprise Product"
    code = re.sub(r"[^A-Za-z0-9]", "", name).upper()[:5] or "PROD"

    domain = "Cloud & Core Infrastructure"
    lower_text = text.lower()
    if any(k in lower_text for k in ["fintech", "banking", "payment", "ledger", "transaction"]):
        domain = "Fintech & Financial Infrastructure"
    elif any(k in lower_text for k in ["health", "medical", "patient", "clinical", "hospital"]):
        domain = "Healthcare & Life Sciences"
    elif any(k in lower_text for k in ["robotics", "drone", "hardware", "iot", "sensor"]):
        domain = "Autonomous Systems & Robotics"
    elif any(k in lower_text for k in ["security", "auth", "identity", "crypto", "appsec"]):
        domain = "Cybersecurity & Identity"
    elif any(k in lower_text for k in ["ai", "agent", "llm", "rag", "neural", "deep learning"]):
        domain = "AI & Autonomous Agents"

    summary = " ".join(lines[1:5])[:450] if len(lines) > 1 else text[:300]

    features: list[str] = []
    for line in lines:
        if line.startswith(("- ", "* ", "1.", "2.", "3.", "• ")):
            item = re.sub(r"^[-*•0-9.]+\s*", "", line).strip()
            if len(item) > 4 and item not in features and len(features) < 6:
                features.append(item)

    if not features:
        features = [
            f"Core {name} operational engine",
            "Real-time event processing and ledger audit trail",
            "Autonomous agent execution & test verification pipeline",
            "Role-based access governance and policy enforcement",
        ]

    tech_candidates = ["TypeScript", "Python", "Rust", "Go", "PostgreSQL", "Cloud Run", "Docker", "pgvector", "FastAPI", "React", "Next.js", "Redis", "Kafka", "Kubernetes"]
    detected_tech = [t for t in tech_candidates if re.search(rf"\b{re.escape(t)}\b", text, re.IGNORECASE)]
    if not detected_tech:
        detected_tech = ["TypeScript", "Python", "FastAPI", "PostgreSQL", "pgvector", "Docker"]

    return ExtractedProductSpec(
        name=name,
        code=code,
        domain=domain,
        description=summary or f"High-performance {domain} platform built for enterprise reliability.",
        value_proposition=f"Eliminates manual engineering bottlenecks and automates end-to-end delivery for {name}.",
        target_personas=["Lead Engineers", "Product Managers", "Systems Architects", "Enterprise SREs"],
        key_features=features,
        tech_stack=detected_tech,
        constraints=["Zero-downtime deployment", "SOC2 compliance & audit trail", "Strict schema validation"],
        security_requirements=["End-to-end TLS 1.3 encryption", "Role-based access control", "Tamper-evident ledger logging"],
        suggested_epics=[f"EPIC-1: {name} Core Architecture & Data Model", f"EPIC-2: {name} API Gateway & Services", f"EPIC-3: {name} Verification & Release Gates"],
    )


@router.post("/api/products/extract-from-doc", response_model=DocumentExtractResponse)
async def extract_product_from_doc(
    payload: DocumentExtractRequest,
    session: Session,
    user: CurrentUser,
) -> DocumentExtractResponse:
    """Parses product documents, stores semantic chunks in pgvector, and extracts full structured product spec."""
    raw_text = payload.text.strip()
    if not raw_text:
        raise HTTPException(status_code=400, detail="Document text cannot be empty.")
    # Documents may only be stored into a workspace (and product) the caller can write in.
    if payload.workspace_id:
        (await wa.workspace_access(session, user, payload.workspace_id)).require_write()
        if payload.product_id:
            target = await session.get(Product, payload.product_id)
            if target is None or target.workspace_id != payload.workspace_id:
                raise HTTPException(status_code=400, detail="That product is not in this workspace.")
    elif payload.product_id:
        raise HTTPException(status_code=400, detail="workspace_id is required with product_id")

    chunks = _chunk_text(raw_text)
    embed_model = llm.embed_model_name()

    doc = ProductDocument(
        id=uuid.uuid4(),
        product_id=payload.product_id,
        workspace_id=payload.workspace_id,
        filename=payload.filename,
        content_type=payload.content_type,
        extracted_text=raw_text,
        created_by=user.id,
    )
    session.add(doc)
    await session.flush()

    stored_chunks_count = 0
    for idx, chunk in enumerate(chunks):
        embedding_vec: list[float] | None = None
        try:
            embedding_vec = await llm.embed(chunk, task_type="RETRIEVAL_DOCUMENT")
        except ModelError as exc:
            logger.warning(f"Embedding generation skipped for chunk {idx}: {exc}")
        except Exception as exc:
            logger.warning(f"Embedding error: {exc}")

        chunk_rec = ProductDocumentChunk(
            id=uuid.uuid4(),
            document_id=doc.id,
            product_id=payload.product_id,
            chunk_index=idx,
            chunk_text=chunk,
            embedding=embedding_vec,
            embedding_model=embed_model if embedding_vec else None,
        )
        session.add(chunk_rec)
        stored_chunks_count += 1

    spec: ExtractedProductSpec | None = None
    try:
        extraction_prompt = (
            "You are the Chief Systems & Product Architect at Software Karkhana.\n"
            "Extract comprehensive, production-grade product specifications from this documentation:\n\n"
            f"--- DOCUMENT START ({payload.filename}) ---\n"
            f"{raw_text[:8000]}\n"
            "--- DOCUMENT END ---\n\n"
            "Produce an exhaustive, precise JSON product definition with name, code, domain, description, "
            "value_proposition, target_personas, key_features, tech_stack, constraints, security_requirements, and suggested_epics."
        )
        spec = await llm.generate_structured(
            prompt=extraction_prompt,
            schema=ExtractedProductSpec,
            system="You are an expert product architect who extracts structured engineering requirements.",
            temperature=0.2,
        )
    except Exception as exc:
        logger.info(f"Using heuristic extraction: {exc}")
        spec = _fallback_extract_spec(raw_text, payload.filename)

    doc.parsed_spec = spec.model_dump(mode="json")
    session.add(doc)
    await session.commit()

    return DocumentExtractResponse(
        document_id=str(doc.id),
        chunks_stored=stored_chunks_count,
        spec=spec,
    )
