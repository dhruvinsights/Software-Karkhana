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
from app.ai import evaluator, genai
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
async def list_projects(session: Session, _: CurrentUser) -> list[Project]:
    """All projects, newest first."""
    return list(
        (
            await session.scalars(select(Project).order_by(Project.created_at.desc()))
        ).all()
    )


@router.post("", response_model=ProjectOut, status_code=status.HTTP_202_ACCEPTED)
async def create_project(
    body: ProjectCreate,
    background: BackgroundTasks,
    session: Session,
    user: Annotated[User, Depends(require_role(Role.PM))],
) -> Project:
    """A PM submits an idea. Evaluation runs in the background; poll the project."""
    project = Project(
        id=uuid.uuid4(),
        name=body.name.strip(),
        idea_text=body.idea_text.strip(),
        created_by=user.id,
    )
    session.add(project)
    await session.flush()
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="project.created",
        subject_type="project",
        subject_id=project.id,
        project_id=project.id,
        payload={"name": project.name, "idea_chars": len(project.idea_text)},
    )
    await session.commit()  # The background job reads the project in its own session.
    background.add_task(run_evaluation, project.id)
    return project


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
        except genai.ModelError as exc:
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
            served_from_cache=result.served_from_cache,
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
                "served_from_cache": result.served_from_cache,
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
            served_from_cache=ev.served_from_cache,
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
