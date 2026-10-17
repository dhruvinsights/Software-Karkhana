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

"""Read-mostly endpoints: me, stages, board, ledger, learnings, portfolio (A5, A6, A7, B2, B5)."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, ledger
from app.auth import CurrentUser
from app.db import get_session
from app.models import (
    Approval,
    Learning,
    LedgerEntry,
    Project,
    PullRequest,
    ReviewComment,
    Run,
    Task,
    User,
    WorkspaceMember,
)
from app.process import STAGE_INDEX, STAGES
from app.routers.common import get_or_404
from app.schemas import (
    AnchorOut,
    ChainOut,
    ChainReportOut,
    LearningOut,
    LedgerOut,
    StageOut,
    TaskOut,
    UserOut,
)

router = APIRouter(prefix="/api", tags=["platform"])
Session = Annotated[AsyncSession, Depends(get_session)]
BOARD_COLUMNS = ("backlog", "ready", "in_progress", "review", "done")


@router.get("/prs")
async def list_prs(
    session: Session,
    user: CurrentUser,
    project_id: uuid.UUID | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[dict]:
    """All pull requests visible to this user, with task/project context.

    Returned shape matches ``PrRow`` in the frontend ``api.ts``.
    """
    q = (
        select(PullRequest, Task, Project)
        .join(Task, Task.id == PullRequest.task_id)
        .join(Project, (Project.id == Task.project_id) & (Project.archived_at.is_(None)))
        .order_by(PullRequest.number.desc())
    )
    if project_id:
        q = q.where(Task.project_id == project_id)
    if status_filter:
        q = q.where(PullRequest.status == status_filter)

    rows = []
    for pr, task, project in (await session.execute(q)).all():
        open_c = await session.scalar(
            select(func.count())
            .select_from(ReviewComment)
            .where(ReviewComment.pr_id == pr.id, ReviewComment.triage == "open")
        )
        total_c = await session.scalar(
            select(func.count())
            .select_from(ReviewComment)
            .where(ReviewComment.pr_id == pr.id)
        )
        rows.append(
            {
                "id": str(pr.id),
                "number": pr.number,
                "url": pr.url,
                "branch": pr.branch,
                "status": pr.status,
                "tests_passed": pr.tests_passed,
                "reviewed": pr.reviewed_at is not None,
                "review_engine": pr.review_engine,
                "review_model": pr.review_model,
                "review_summary": pr.review_summary,
                "open_comments": open_c or 0,
                "total_comments": total_c or 0,
                "task_id": str(task.id),
                "task_key": task.key,
                "task_title": task.title,
                "project_id": str(project.id),
                "project_name": project.name,
            }
        )
    return rows


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser, session: Session) -> UserOut:
    """The signed-in user, with the role they hold in their primary workspace.

    The role is a label for the UI; every server-side check uses the role in
    the workspace of the resource being acted on.
    """
    out = UserOut.model_validate(user)
    out.role = await access.display_role(session, user)
    return out


@router.get("/stages", response_model=list[StageOut])
async def stages(_: CurrentUser) -> list[StageOut]:
    """The 15 lifecycle stages, with which ones are wired in this build."""
    return [StageOut(**s.__dict__) for s in STAGES]


@router.get("/projects/{project_id}/board")
async def board(project_id: uuid.UUID, session: Session, user: CurrentUser) -> dict:
    """Task board columns. Draft cards are shown separately until approval."""
    await access.get_visible_project(session, user, project_id)
    tasks = (
        await session.scalars(
            select(Task).where(Task.project_id == project_id).order_by(Task.key)
        )
    ).all()
    cols: dict[str, list[TaskOut]] = {c: [] for c in ("draft", *BOARD_COLUMNS)}
    for t in tasks:
        cols[t.status].append(TaskOut.model_validate(t))
    return {"columns": cols}


@router.get("/ledger", response_model=list[LedgerOut])
async def list_ledger(
    session: Session,
    user: CurrentUser,
    project_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[LedgerEntry]:
    """Newest ledger entries, optionally for one project."""
    q = select(LedgerEntry).order_by(LedgerEntry.seq.desc()).limit(limit)
    if project_id:
        await access.get_visible_project(session, user, project_id)
        q = q.where(LedgerEntry.project_id == project_id)
    else:
        q = q.where(
            LedgerEntry.project_id.in_(
                select(Project.id).where(access.visible_projects(user))
            )
        )
    return list((await session.scalars(q)).all())


def _my_workspaces(user: User):
    """Subquery: ids of the workspaces ``user`` is a member of."""
    return select(WorkspaceMember.workspace_id).where(
        WorkspaceMember.user_id == user.id
    )


async def _require_member(
    session: AsyncSession, user: User, workspace_id: uuid.UUID
) -> None:
    member = await session.scalar(
        select(WorkspaceMember.id).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user.id,
        )
    )
    if member is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You are not a member of this workspace."
        )


@router.get("/ledger/verify", response_model=ChainOut)
async def verify_ledger(
    session: Session, user: CurrentUser, workspace_id: uuid.UUID | None = None
) -> ChainOut:
    """Recomputes the caller's chains from genesis.

    With ``workspace_id``, only that workspace's chain (members only). Without
    it, every workspace the caller belongs to plus the shared ``platform``
    chain (rows with no workspace). Other tenants' rows are never read. The
    pre-014 ``legacy`` chain mixes tenants and is verified by operators with
    ``python -m app.scripts.anchor_ledger --verify``.
    """
    if workspace_id is not None:
        await _require_member(session, user, workspace_id)
        chains = [ledger.chain_for(workspace_id)]
    else:
        mine = (await session.scalars(_my_workspaces(user))).all()
        chains = [ledger.chain_for(w) for w in sorted(set(mine), key=str)]
        chains.append(ledger.PLATFORM_CHAIN)
    reports = [await ledger.verify_chain(session, c) for c in chains]
    first_bad = next((r for r in reports if not r.ok), None)
    return ChainOut(
        ok=first_bad is None,
        entries=sum(r.entries for r in reports),
        head=reports[0].head if len(reports) == 1 else "",
        first_bad_seq=first_bad.first_bad_seq if first_bad else None,
        reason=f"{first_bad.chain}: {first_bad.reason}" if first_bad else None,
        chains=[
            ChainReportOut(
                chain=r.chain,
                workspace_id=None if r.chain == ledger.PLATFORM_CHAIN else r.chain,
                ok=r.ok,
                entries=r.entries,
                head=r.head,
                first_bad_seq=r.first_bad_seq,
                reason=r.reason,
            )
            for r in reports
        ],
    )


@router.post("/ledger/anchor", response_model=AnchorOut)
async def anchor_ledger(
    session: Session, user: CurrentUser, workspace_id: uuid.UUID
) -> AnchorOut:
    """Writes this workspace's chain head to the external anchor sink now.

    Any workspace member may take an anchor (it only adds evidence). A sink
    failure is reported in the body (``ok: false``), never as a 5xx.
    """
    await _require_member(session, user, workspace_id)
    chain = ledger.chain_for(workspace_id)
    res = await ledger.anchor_head(session, chain, reason="manual")
    if res is None:
        return AnchorOut(ok=False, chain=chain, error="chain is empty")
    return AnchorOut(
        ok=res.ok,
        chain=chain,
        sink=res.sink,
        location=res.location,
        position=res.anchor.position,
        hash=res.anchor.hash,
        anchored_at=res.anchor.anchored_at,
        error=res.error,
    )


@router.get("/learnings", response_model=list[LearningOut])
async def list_learnings(session: Session, user: CurrentUser) -> list[Learning]:
    """Learnings attached to projects the caller may access."""
    return list(
        (
            await session.scalars(
                select(Learning)
                .join(Project, Project.id == Learning.project_id)
                .where(access.visible_projects(user))
                .order_by(Learning.created_at.desc())
            )
        ).all()
    )


@router.post("/learnings/{learning_id}/verify", response_model=LearningOut)
async def verify_learning(
    learning_id: uuid.UUID,
    session: Session,
    user: CurrentUser,
    decision: Annotated[str, Query(pattern="^(verified|rejected)$")] = "verified",
) -> Learning:
    """A lead verifies (or rejects) a learning. Only verified ones are reused.

    The caller must be a lead or director in the learning's project workspace.
    """
    lr = await get_or_404(session, Learning, learning_id)
    project = await session.get(Project, lr.project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Learning not found")
    role = await access.effective_role(session, user, project.workspace_id)
    if not role:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Learning not found")
    if role not in {"lead", "director"}:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only a lead or director verifies learnings"
        )
    if lr.status != "unverified":
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Learning is already {lr.status}"
        )
    lr.status, lr.verified_by, lr.verified_at = (
        decision,
        user.id,
        dt.datetime.now(dt.UTC),
    )
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action=f"learning.{decision}",
        subject_type="learning",
        subject_id=lr.id,
        project_id=lr.project_id,
        payload={"embedded": lr.embedding is not None},
    )
    return lr


@router.get("/portfolio")
async def portfolio(session: Session, _: CurrentUser) -> list[dict]:
    """Each project's stage and gate status. Claims nothing beyond the evidence."""
    projects = (
        await session.scalars(select(Project).where(Project.archived_at.is_(None)).order_by(Project.created_at))
    ).all()
    rows = []
    for p in projects:
        idx = STAGE_INDEX.get(p.stage, 0)
        approved = await session.scalar(
            select(func.count())
            .select_from(Approval)
            .where(Approval.project_id == p.id, Approval.decision == "approved")
        )
        task_counts = dict(
            (
                await session.execute(
                    select(Task.status, func.count())
                    .where(Task.project_id == p.id)
                    .group_by(Task.status)
                )
            ).all()
        )
        merged = await session.scalar(
            select(func.count())
            .select_from(PullRequest)
            .join(Task, Task.id == PullRequest.task_id)
            .where(Task.project_id == p.id, PullRequest.status == "merged")
        )
        runs = await session.scalar(
            select(func.count()).select_from(Run).where(Run.project_id == p.id)
        )
        gates = []
        for s in STAGES:
            if s.id == "evaluate":
                state = (
                    "passed"
                    if approved
                    else ("rejected" if p.stage_status == "rejected" else "pending")
                )
            elif s.id == "review":
                state = "passed" if merged else "pending"
            elif s.id in ("qa", "security", "cicd", "release"):
                state = "pending"  # Verify and ship gates: never claimed by this build.
            elif not s.wired:
                state = "planned"
            else:
                state = (
                    "passed"
                    if STAGE_INDEX[s.id] < idx
                    else ("current" if s.id == p.stage else "pending")
                )
            gates.append(
                {
                    "stage": s.id,
                    "name": s.name,
                    "gate": s.gate,
                    "wired": s.wired,
                    "state": state,
                }
            )
        rows.append(
            {
                "id": str(p.id),
                "name": p.name,
                "stage": p.stage,
                "stage_status": p.stage_status,
                "tasks": task_counts,
                "merged_prs": merged,
                "runs": runs,
                "gates": gates,
                "production_ready": False,
            }
        )
    return rows
