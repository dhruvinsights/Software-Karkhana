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

"""Project documents (PRD, ERD) drafted by AI: read, print and re-draft.

Approval is part of approving the plan (``POST /api/projects/{id}/plan/approve``),
so the documents and the backlog a team builds against are approved together.
"""

from __future__ import annotations

import re
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, db, reports
from app.auth import CurrentUser
from app.models import Epic, Product, Project, ProjectDocument, Task, User
from app.services import project_docs

router = APIRouter(tags=["project_docs"])
Session = Annotated[AsyncSession, Depends(db.get_session)]


async def _latest(session: AsyncSession, project_id: uuid.UUID) -> dict[str, ProjectDocument]:
    rows = (
        await session.scalars(
            select(ProjectDocument)
            .where(ProjectDocument.project_id == project_id)
            .order_by(ProjectDocument.kind, ProjectDocument.version.desc())
        )
    ).all()
    latest: dict[str, ProjectDocument] = {}
    for doc in rows:
        latest.setdefault(doc.kind, doc)
    return latest


def _doc_out(doc: ProjectDocument) -> dict[str, Any]:
    out = {
        "id": str(doc.id),
        "kind": doc.kind,
        "version": doc.version,
        "title": doc.title,
        "status": doc.status,
        "model": doc.model,
        "content": doc.content,
        "createdAt": doc.created_at.isoformat(),
        "approvedAt": doc.approved_at.isoformat() if doc.approved_at else None,
    }
    if doc.kind == "erd":
        out["mermaid"] = project_docs.mermaid(doc.content)
    return out


@router.get("/api/projects/{project_id}/documents")
async def list_documents(project_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """The drafting job's progress and the latest version of each document."""
    project = await access.get_visible_project(session, user, project_id)
    latest = await _latest(session, project.id)
    return {"status": project.docs_status, "documents": [_doc_out(d) for d in latest.values()]}


async def _plan_html(session: AsyncSession, project: Project) -> str:
    latest = await _latest(session, project.id)
    prd = latest.get("prd")
    if prd is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This project has no PRD yet.")
    epics = (await session.scalars(select(Epic).where(Epic.project_id == project.id).order_by(Epic.position))).all()
    stories = (await session.scalars(select(Task).where(Task.project_id == project.id).order_by(Task.created_at))).all()
    approver = await session.get(User, prd.approved_by) if prd.approved_by else None
    product = await session.get(Product, project.product_id) if project.product_id else None
    return reports.project_plan_html(
        project=project,
        product=product,
        prd_doc=prd,
        erd_doc=latest.get("erd"),
        epics=list(epics),
        stories=list(stories),
        approver=approver.display_name if approver else None,
    )


@router.get("/api/projects/{project_id}/documents/plan.html", response_class=HTMLResponse)
async def plan_page(project_id: uuid.UUID, session: Session, user: CurrentUser) -> HTMLResponse:
    """PRD, data model and backlog as one printable page."""
    project = await access.get_visible_project(session, user, project_id)
    return HTMLResponse(await _plan_html(session, project))


@router.get("/api/projects/{project_id}/documents/plan.pdf")
async def plan_pdf(project_id: uuid.UUID, session: Session, user: CurrentUser) -> Response:
    """PRD, data model and backlog as an A4 PDF."""
    project = await access.get_visible_project(session, user, project_id)
    pdf = await reports.to_pdf(await _plan_html(session, project), title=f"{project.name} · PRD")
    name = re.sub(r"[^A-Za-z0-9]+", "-", project.name).strip("-")[:80] or "project"
    return Response(
        pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}-PRD.pdf"'}
    )


@router.post("/api/projects/{project_id}/documents/redraft", status_code=status.HTTP_202_ACCEPTED)
async def redraft(
    project_id: uuid.UUID, session: Session, user: CurrentUser, background: BackgroundTasks
) -> dict[str, Any]:
    """Drafts the PRD, ERD and backlog again (new versions), until the plan is approved."""
    project = await access.get_visible_project(session, user, project_id)
    mine = await access.my_access(session, user, project)
    if not (mine["canManage"] or mine["isLead"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a project lead or manager can re-draft the plan.")
    if project.stage != "evaluate":
        raise HTTPException(status.HTTP_409_CONFLICT, "The plan is already approved.")
    if (project.docs_status or {}).get("state") == "running":
        raise HTTPException(status.HTTP_409_CONFLICT, "The plan is being drafted right now.")
    background.add_task(project_docs.run, project.id)
    return {"status": "running"}
