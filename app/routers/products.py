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
import re
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db, ledger
import logging
from app.ai import llm
from app.ai.errors import ModelError
from app.auth import CurrentUser
from app.models import (
    Idea,
    Product,
    ProductDocument,
    ProductDocumentChunk,
    Project,
    Workspace,
)
from app.schemas import (
    DocumentExtractRequest,
    DocumentExtractResponse,
    ExtractedProductSpec,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["products_and_ideas"])
Session = Annotated[AsyncSession, Depends(db.get_session)]


class ProductCreatePayload(BaseModel):
    name: str
    code: str | None = None
    domain: str = "Cloud Services"
    description: str = ""
    workspace_id: str | None = None


class IdeaCreatePayload(BaseModel):
    title: str
    problem_statement: str
    target_user: str = "Enterprise Users"
    expected_value: str = ""
    product_id: str | None = None
    workspace_id: str | None = None
    complexity: str = "Medium"
    tags: list[str] = Field(default_factory=list)


class IdeaUpdatePayload(BaseModel):
    title: str | None = None
    problem_statement: str | None = None
    expected_value: str | None = None
    status: str | None = None
    complexity: str | None = None
    tags: list[str] | None = None
    assessment: dict[str, Any] | None = None


@router.get("/api/products")
async def list_products(
    session: Session,
    user: CurrentUser,
    workspace_id: str | None = None,
) -> list[dict[str, Any]]:
    """Lists products in the workspace."""
    stmt = select(Product).order_by(Product.created_at.desc())
    if workspace_id:
        try:
            ws_uuid = uuid.UUID(workspace_id)
            stmt = stmt.where(Product.workspace_id == ws_uuid)
        except ValueError:
            pass

    products = (await session.scalars(stmt)).all()
    return [
        {
            "id": str(p.id),
            "workspaceId": str(p.workspace_id) if p.workspace_id else None,
            "name": p.name,
            "code": p.code,
            "domain": p.domain,
            "description": p.description,
            "status": p.status,
            "createdAt": p.created_at.isoformat(),
        }
        for p in products
    ]


@router.post("/api/products", status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreatePayload,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Creates a new product anchor."""
    code = payload.code or re.sub(r"[^A-Za-z0-9]", "", payload.name).upper()[:6] or "PROD"
    ws_uuid = uuid.UUID(payload.workspace_id) if payload.workspace_id else None

    product = Product(
        id=uuid.uuid4(),
        workspace_id=ws_uuid,
        name=payload.name.strip(),
        code=code,
        domain=payload.domain.strip(),
        description=payload.description.strip(),
        status="active",
        created_by=user.id,
    )
    session.add(product)
    await session.flush()

    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="product.created",
        subject_type="product",
        subject_id=product.id,
        payload={"name": product.name, "code": product.code, "domain": product.domain},
    )

    created_str = (product.created_at or dt.datetime.now(dt.timezone.utc)).isoformat()
    return {
        "id": str(product.id),
        "workspaceId": str(product.workspace_id) if product.workspace_id else None,
        "name": product.name,
        "code": product.code,
        "domain": product.domain,
        "description": product.description,
        "status": product.status,
        "createdAt": created_str,
    }


@router.get("/api/ideas")
async def list_ideas(
    session: Session,
    user: CurrentUser,
    product_id: str | None = None,
) -> list[dict[str, Any]]:
    """Lists feature ideas."""
    stmt = select(Idea).order_by(Idea.created_at.desc())
    if product_id:
        try:
            prod_uuid = uuid.UUID(product_id)
            stmt = stmt.where(Idea.product_id == prod_uuid)
        except ValueError:
            pass

    ideas = (await session.scalars(stmt)).all()
    return [
        {
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
            "promotedProjectId": str(i.project_id) if i.project_id else None,
            "createdAt": i.created_at.isoformat(),
            "updatedAt": i.updated_at.isoformat() if i.updated_at else i.created_at.isoformat(),
        }
        for i in ideas
    ]


@router.post("/api/ideas", status_code=status.HTTP_201_CREATED)
async def create_idea(
    payload: IdeaCreatePayload,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Creates a new feature idea for validation."""
    prod_uuid = uuid.UUID(payload.product_id) if payload.product_id else None
    ws_uuid = uuid.UUID(payload.workspace_id) if payload.workspace_id else None

    idea = Idea(
        id=uuid.uuid4(),
        product_id=prod_uuid,
        workspace_id=ws_uuid,
        title=payload.title.strip(),
        problem_statement=payload.problem_statement.strip(),
        target_user=payload.target_user.strip(),
        expected_value=payload.expected_value.strip(),
        author_id=user.id,
        status="draft",
        complexity=payload.complexity,
        tags=payload.tags,
        assessment=None,
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

    created_str = (idea.created_at or dt.datetime.now(dt.timezone.utc)).isoformat()
    return {
        "id": str(idea.id),
        "productId": str(idea.product_id) if idea.product_id else None,
        "workspaceId": str(idea.workspace_id) if idea.workspace_id else None,
        "title": idea.title,
        "problemStatement": idea.problem_statement,
        "targetUser": idea.target_user,
        "expectedValue": idea.expected_value,
        "authorId": str(idea.author_id),
        "status": idea.status,
        "complexity": idea.complexity,
        "tags": idea.tags,
        "assessment": idea.assessment,
        "createdAt": created_str,
        "updatedAt": created_str,
    }


@router.put("/api/ideas/{idea_id}")
async def update_idea(
    idea_id: str,
    payload: IdeaUpdatePayload,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Updates an existing idea status or assessment."""
    try:
        idea_uuid = uuid.UUID(idea_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid idea ID format.")

    idea = await session.scalar(select(Idea).where(Idea.id == idea_uuid))
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found.")

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
