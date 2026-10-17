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

"""Project documents drafted by AI.

The PRD and ERD are approved together with the plan; the design spec is
approved by the design station and then handed to developers.
"""

from __future__ import annotations

import datetime as dt
import re
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, db, ledger, reports
from app.auth import CurrentUser
from app.models import (
    ContextEntry,
    Epic,
    Product,
    Project,
    ProjectDocument,
    ProjectMember,
    Task,
    User,
)
from app.notifications import email_people
from app.services import design, project_docs
from app.services.realtime import notify_workspace

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


@router.post("/api/projects/{project_id}/design", status_code=status.HTTP_202_ACCEPTED)
async def draft_design(
    project_id: uuid.UUID, session: Session, user: CurrentUser, background: BackgroundTasks
) -> dict[str, Any]:
    """The design station drafts the next design spec version from the approved plan."""
    project = await access.get_visible_project(session, user, project_id)
    await access.ensure_station(session, user, project, "design")
    if ((project.docs_status or {}).get("design") or {}).get("state") == "running":
        raise HTTPException(status.HTTP_409_CONFLICT, "The design is being drafted right now.")
    background.add_task(design.run, project.id, user.id)
    return {"status": "running"}


@router.post("/api/projects/{project_id}/documents/design/approve")
async def approve_design(project_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """The designer signs off the latest design; developers get the handoff."""
    project = await access.get_visible_project(session, user, project_id)
    await access.ensure_station(session, user, project, "design")
    doc = (await _latest(session, project.id)).get("design")
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "There is no design to approve.")
    if doc.status == "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Design v{doc.version} is already approved.")
    doc.status, doc.approved_by, doc.approved_at = "approved", user.id, dt.datetime.now(dt.UTC)
    spec = doc.content
    contracts = "; ".join(f"{c['method']} {c['path']} ({', '.join(c['story_keys'])})" for c in spec["api_contracts"])
    session.add(
        ContextEntry(
            project_id=project.id,
            kind="handoff",
            title=f"Design v{doc.version} approved by {user.display_name}"[:140],
            body=(
                f"{spec['overview']}\nContracts: {contracts or 'none'}.\n"
                f"Screens: {', '.join(s['name'] for s in spec['screens']) or 'none'}.\n"
                "Handoff notes: " + " ".join(spec["handoff_notes"])
            )[:4000],
            author_label=user.display_name,
            author_kind="human",
        )
    )
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="design.approved",
        subject_type="project",
        subject_id=project.id,
        project_id=project.id,
        payload={"version": doc.version, "contracts": len(spec["api_contracts"]), "screens": len(spec["screens"])},
    )
    developers = (
        await session.scalars(
            select(ProjectMember.user_id).where(
                ProjectMember.project_id == project.id, ProjectMember.stations.contains(["developer"])
            )
        )
    ).all()
    await session.commit()
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "projects")
    await email_people(
        session,
        [d for d in developers if d != user.id],
        subject=f"Design ready to build: {project.name}",
        heading=f"{user.display_name} approved the design for {project.name}",
        lines=[spec["overview"], "Open the project's Design station for the API contracts and screens."],
    )
    return _doc_out(doc)
