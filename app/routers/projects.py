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

"""Projects: idea submission (A2), evaluation (A3) and the director gate (A4)."""

from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import ledger, memory, process
from app.ai import evaluator
from app.ai.errors import ModelError
from app.auth import CurrentUser, require_role
from app.db import get_session, sessionmaker
from app.integrations import chat
from app.models import (
    Approval,
    Epic,
    Evaluation,
    Learning,
    Project,
    PullRequest,
    Task,
    User,
)
from app.process import Event, Role
from app.routers.common import advance_or_http, get_or_404
from app.schemas import (
    ApprovalOut,
    BatchApprovalOut,
    BatchDecision,
    CitationOut,
    Decision,
    EpicOut,
    EvaluationOut,
    EvaluationOutput,
    ProjectCreate,
    ProjectOut,
    TaskOut,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/projects", tags=["projects"])
Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    session: Session,
    _: CurrentUser,
    product_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
) -> list[Project]:
    """All projects, newest first, optionally filtered by product or workspace."""
    stmt = select(Project).order_by(Project.created_at.desc())
    if product_id:
        stmt = stmt.where(Project.product_id == product_id)
    if workspace_id:
        stmt = stmt.where(Project.workspace_id == workspace_id)
    return list((await session.scalars(stmt)).all())


@router.post("", response_model=ProjectOut, status_code=status.HTTP_202_ACCEPTED)
async def create_project(
    body: ProjectCreate,
    background: BackgroundTasks,
    session: Session,
    user: CurrentUser,
) -> Project:
    """Any authenticated team member (Developer, PM, Architect, Lead) can create a project."""
    idea_text = body.idea_text.strip() if body.idea_text else f"Project {body.name.strip()} initialized."
    settings_dict = {}
    if body.code:
        settings_dict["code"] = body.code
    if body.description:
        settings_dict["description"] = body.description
    if body.repository_url:
        settings_dict["repository_url"] = body.repository_url
    if body.target_release_date:
        settings_dict["target_release_date"] = body.target_release_date

    project = Project(
        id=uuid.uuid4(),
        product_id=body.product_id,
        workspace_id=body.workspace_id,
        lead_id=user.id,
        name=body.name.strip(),
        idea_text=idea_text,
        created_by=user.id,
        settings=settings_dict,
    )
    session.add(project)
    await session.flush()

    # Automatically add the creator as lead with all station permissions
    from app.models import ProjectMember
    creator_member = ProjectMember(
        id=uuid.uuid4(),
        project_id=project.id,
        user_id=user.id,
        role=user.role or "lead",
        stations=["product", "architecture", "developer", "qa", "devops", "security", "release"],
    )
    session.add(creator_member)

    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="project.created",
        subject_type="project",
        subject_id=project.id,
        project_id=project.id,
        payload={"name": project.name, "created_by": str(user.id), "role": user.role},
    )
    await session.commit()
    background.add_task(run_evaluation, project.id)
    return project


@router.get("/{project_id}/members")
async def list_project_members(
    project_id: uuid.UUID,
    session: Session,
    _: CurrentUser,
) -> list[dict]:
    """Lists all team members assigned to the project with their station permissions."""
    from app.models import ProjectMember, User
    stmt = (
        select(ProjectMember, User)
        .join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project_id)
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": str(pm.id),
            "projectId": str(pm.project_id),
            "userId": str(pm.user_id),
            "name": u.display_name,
            "email": u.email,
            "role": pm.role,
            "stations": pm.stations or [],
            "avatarUrl": u.avatar_url,
            "joinedAt": pm.joined_at.isoformat(),
        }
        for pm, u in rows
    ]


@router.post("/{project_id}/members")
async def add_project_member(
    project_id: uuid.UUID,
    payload: dict,
    session: Session,
    user: CurrentUser,
) -> dict:
    """Assigns or updates a member's role and stations on the project."""
    from app.models import ProjectMember
    user_id_str = payload.get("user_id") or payload.get("userId")
    if not user_id_str:
        raise HTTPException(status_code=400, detail="User ID is required.")
    target_user_id = uuid.UUID(str(user_id_str))
    role = payload.get("role", "developer")
    stations = payload.get("stations", ["product", "architecture", "developer", "qa", "devops", "security", "release"])

    existing = await session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == target_user_id,
        )
    )
    if existing:
        existing.role = role
        existing.stations = stations
        session.add(existing)
        member = existing
    else:
        member = ProjectMember(
            id=uuid.uuid4(),
            project_id=project_id,
            user_id=target_user_id,
            role=role,
            stations=stations,
        )
        session.add(member)

    await session.commit()
    return {
        "status": "ok",
        "memberId": str(member.id),
        "projectId": str(project_id),
        "userId": str(target_user_id),
        "role": member.role,
        "stations": member.stations,
    }


@router.post("/{project_id}/evaluate", status_code=status.HTTP_202_ACCEPTED)
async def reevaluate(
    project_id: uuid.UUID,
    background: BackgroundTasks,
    session: Session,
    user: Annotated[User, Depends(require_role(Role.PM))],
) -> dict[str, str]:
    """Re-runs the evaluation (e.g. after a rejection)."""
    project = await get_or_404(session, Project, project_id)
    if project.stage_status == "rejected":
        await advance_or_http(
            session,
            project,
            Event.RESUBMIT,
            actor=ledger.Actor.human(user),
            role=Role.PM,
        )
    elif project.stage != "evaluate":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only projects in the evaluate stage can be re-evaluated",
        )
    await session.commit()
    background.add_task(run_evaluation, project.id)
    return {"status": "evaluating"}


async def run_evaluation(project_id: uuid.UUID) -> None:
    """Background job: retrieve memory, evaluate, validate, store, record."""
    async with sessionmaker()() as session:
        project = await session.get(Project, project_id)
        if project is None:
            return
        try:
            hits = await memory.retrieve(session, project.idea_text)
            result = await evaluator.evaluate(
                idea_text=project.idea_text,
                project_name=project.name,
                memory=memory.as_memory_items(hits),
            )
        except ModelError as exc:
            await ledger.append(
                session,
                actor=ledger.Actor.ai("evaluator"),
                action="evaluation.failed",
                subject_type="project",
                subject_id=project.id,
                project_id=project.id,
                payload={"error": str(exc)[:500]},
            )
            await session.commit()
            logger.error("Evaluation failed for %s: %s", project_id, exc)
            return

        version = (
            await session.scalar(
                select(func.coalesce(func.max(Evaluation.version), 0)).where(
                    Evaluation.project_id == project.id
                )
            )
        ) + 1
        out = result.output
        evaluation = Evaluation(
            project_id=project.id,
            version=version,
            payload=out.model_dump(mode="json"),
            model=result.model,
            memory_used=[
                {"learning_id": str(lr.id), "similarity": round(sim, 3)}
                for lr, _, sim in hits
            ],
        )
        session.add(evaluation)

        # Epics and stories are (re)drafted from the latest evaluation. They stay
        # Draft until the director approves.
        old_tasks = (
            await session.scalars(select(Task).where(Task.project_id == project.id))
        ).all()
        if any(t.status != "draft" for t in old_tasks):
            logger.info(
                "Project %s already has live tasks; keeping the board", project.id
            )
        else:
            for t in old_tasks:
                await session.delete(t)
            for e in (
                await session.scalars(select(Epic).where(Epic.project_id == project.id))
            ).all():
                await session.delete(e)
            await session.flush()
            n = 0
            for pos, ep in enumerate(out.epics):
                epic = Epic(
                    id=uuid.uuid4(),
                    project_id=project.id,
                    title=ep.title,
                    description=ep.description,
                    source_quote=ep.source_quote,
                    position=pos,
                )
                session.add(epic)
                for story in ep.stories:
                    n += 1
                    session.add(
                        Task(
                            project_id=project.id,
                            epic_id=epic.id,
                            key=f"KAR-{n}",
                            title=story.title,
                            description=ep.description,
                            acceptance_criteria=story.acceptance_criteria,
                            status="draft",
                        )
                    )
        await session.flush()
        await process.advance(
            session,
            project,
            Event.EVALUATED,
            actor=ledger.Actor.ai("evaluator"),
            role=None,
            payload={
                "evaluation_version": version,
                "score": out.score,
                "epics": len(out.epics),
                "schema_valid": True,
                "source_quotes_verified": True,
                "memory_citations": len(out.memory_citations),
                "model": result.model,
            },
        )
        await session.commit()
    await chat.notify(
        f"Karkhana: '{project.name}' was evaluated (score {out.score}/10). A director decision is needed."
    )


async def _citations(session: AsyncSession, out: EvaluationOutput) -> list[CitationOut]:
    """Enriches model citations from the database: project, PR, verifier."""
    result = []
    for c in out.memory_citations:
        try:
            lid = uuid.UUID(c.learning_id)
        except ValueError:
            continue
        row = (
            await session.execute(
                select(Learning, Project.name, User.email, PullRequest.url)
                .join(Project, Project.id == Learning.project_id)
                .outerjoin(User, User.id == Learning.verified_by)
                .outerjoin(PullRequest, PullRequest.id == Learning.pr_id)
                .where(Learning.id == lid, Learning.status == "verified")
            )
        ).first()
        if row:
            lr, pname, verifier, pr_url = row
            result.append(
                CitationOut(
                    learning_id=lr.id,
                    text=lr.text,
                    source_project=pname,
                    source_pr_url=pr_url,
                    verified_by=verifier,
                    verified_at=lr.verified_at,
                    how_it_applies=c.how_it_applies,
                )
            )
    return result


@router.get("/{project_id}")
async def get_project(project_id: uuid.UUID, session: Session, _: CurrentUser) -> dict:
    """Everything a project screen needs in one call."""
    project = await get_or_404(session, Project, project_id)
    ev = await session.scalar(
        select(Evaluation)
        .where(Evaluation.project_id == project.id)
        .order_by(Evaluation.version.desc())
        .limit(1)
    )
    evaluation = None
    if ev:
        out = EvaluationOutput.model_validate(ev.payload)
        evaluation = EvaluationOut(
            id=ev.id,
            version=ev.version,
            model=ev.model,
            created_at=ev.created_at,
            result=out,
            citations=await _citations(session, out),
        )
    epics = (
        await session.scalars(
            select(Epic).where(Epic.project_id == project.id).order_by(Epic.position)
        )
    ).all()
    tasks = (
        await session.scalars(
            select(Task).where(Task.project_id == project.id).order_by(Task.created_at)
        )
    ).all()
    approvals = (
        await session.scalars(
            select(Approval)
            .where(Approval.project_id == project.id)
            .order_by(Approval.decided_at.desc())
        )
    ).all()
    return {
        "project": ProjectOut.model_validate(project),
        "evaluation": evaluation,
        "epics": [EpicOut.model_validate(e) for e in epics],
        "tasks": [TaskOut.model_validate(t) for t in tasks],
        "approvals": [ApprovalOut.model_validate(a) for a in approvals],
    }


@router.post("/{project_id}/approve", response_model=ApprovalOut)
async def decide(
    project_id: uuid.UUID,
    body: Decision,
    session: Session,
    user: Annotated[User, Depends(require_role(Role.DIRECTOR))],
) -> Approval:
    """Director gate. Non-directors get 403 here, whatever the UI shows."""
    project = await get_or_404(session, Project, project_id)
    event = Event.APPROVE if body.decision == "approved" else Event.REJECT
    actor = ledger.Actor.human(user)
    await advance_or_http(
        session,
        project,
        event,
        actor=actor,
        role=Role.DIRECTOR,
        payload={"reason": body.reason} if body.reason else None,
    )
    approval = Approval(
        project_id=project.id,
        gate="evaluate",
        decision=body.decision,
        reason=body.reason,
        decided_by=user.id,
    )
    session.add(approval)
    await session.flush()
    await ledger.append(
        session,
        actor=actor,
        action=f"approval.{body.decision}",
        subject_type="approval",
        subject_id=approval.id,
        project_id=project.id,
        payload={"gate": "evaluate", "reason": body.reason},
    )
    if body.decision == "approved":
        tasks = (
            await session.scalars(
                select(Task).where(
                    Task.project_id == project.id, Task.status == "draft"
                )
            )
        ).all()
        for t in tasks:
            process.move_task(t, "ready")
        await ledger.append(
            session,
            actor=ledger.SYSTEM,
            action="tasks.ready",
            subject_type="project",
            subject_id=project.id,
            project_id=project.id,
            payload={"tasks": [t.key for t in tasks]},
        )
    return approval


@router.post("/batch-approve", response_model=BatchApprovalOut)
async def batch_decide(
    body: BatchDecision,
    session: Session,
    user: Annotated[User, Depends(require_role(Role.DIRECTOR))],
) -> BatchApprovalOut:
    """Director batch multi-sig gate. Approves/rejects multiple pending project gates at once."""
    approvals_out: list[ApprovalOut] = []
    actor = ledger.Actor.human(user)
    event = Event.APPROVE if body.decision == "approved" else Event.REJECT

    for pid in body.project_ids:
        project = await session.get(Project, pid)
        if not project:
            continue
        try:
            await advance_or_http(
                session,
                project,
                event,
                actor=actor,
                role=Role.DIRECTOR,
                payload={"reason": body.reason, "batch": True} if body.reason else {"batch": True},
            )
            approval = Approval(
                project_id=project.id,
                gate="evaluate",
                decision=body.decision,
                reason=body.reason or "Batch multi-signature approval",
                decided_by=user.id,
            )
            session.add(approval)
            await session.flush()
            await ledger.append(
                session,
                actor=actor,
                action=f"approval.{body.decision}",
                subject_type="approval",
                subject_id=approval.id,
                project_id=project.id,
                payload={"gate": "evaluate", "reason": body.reason, "batch": True},
            )
            if body.decision == "approved":
                tasks = (
                    await session.scalars(
                        select(Task).where(
                            Task.project_id == project.id, Task.status == "draft"
                        )
                    )
                ).all()
                for t in tasks:
                    process.move_task(t, "ready")
                await ledger.append(
                    session,
                    actor=ledger.SYSTEM,
                    action="tasks.ready",
                    subject_type="project",
                    subject_id=project.id,
                    project_id=project.id,
                    payload={"tasks": [t.key for t in tasks]},
                )
            approvals_out.append(ApprovalOut.model_validate(approval))
        except HTTPException:
            # If a project is not in a valid stage for evaluate approval, skip it gracefully
            continue

    await session.commit()
    return BatchApprovalOut(approved_count=len(approvals_out), approvals=approvals_out)
