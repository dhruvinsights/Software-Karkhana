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

from app import ledger
from app.auth import CurrentUser, require_role
from app.db import get_session
from app.models import (
    Approval,
    Learning,
    LedgerEntry,
    Project,
    PullRequest,
    Run,
    Task,
    User,
)
from app.process import STAGE_INDEX, STAGES, Role
from app.routers.common import get_or_404
from app.schemas import ChainOut, LearningOut, LedgerOut, StageOut, TaskOut, UserOut

router = APIRouter(prefix="/api", tags=["platform"])
Session = Annotated[AsyncSession, Depends(get_session)]
BOARD_COLUMNS = ("backlog", "ready", "in_progress", "review", "done")


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    """The signed-in user and their server-side role."""
    return user


@router.get("/stages", response_model=list[StageOut])
async def stages(_: CurrentUser) -> list[StageOut]:
    """The 15 lifecycle stages, with which ones are wired in this build."""
    return [StageOut(**s.__dict__) for s in STAGES]


@router.get("/projects/{project_id}/board")
async def board(project_id: uuid.UUID, session: Session, _: CurrentUser) -> dict:
    """Task board columns. Draft cards are shown separately until approval."""
    await get_or_404(session, Project, project_id)
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
    _: CurrentUser,
    project_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[LedgerEntry]:
    """Newest ledger entries, optionally for one project."""
    q = select(LedgerEntry).order_by(LedgerEntry.seq.desc()).limit(limit)
    if project_id:
        q = q.where(LedgerEntry.project_id == project_id)
    return list((await session.scalars(q)).all())


@router.get("/ledger/verify", response_model=ChainOut)
async def verify_ledger(session: Session, _: CurrentUser) -> ChainOut:
    """Recomputes the whole hash chain from genesis."""
    r = await ledger.verify_chain(session)
    return ChainOut(
        ok=r.ok,
        entries=r.entries,
        head=r.head,
        first_bad_seq=r.first_bad_seq,
        reason=r.reason,
    )


@router.get("/learnings", response_model=list[LearningOut])
async def list_learnings(session: Session, _: CurrentUser) -> list[Learning]:
    """All learnings, newest first."""
    return list(
        (
            await session.scalars(select(Learning).order_by(Learning.created_at.desc()))
        ).all()
    )


@router.post("/learnings/{learning_id}/verify", response_model=LearningOut)
async def verify_learning(
    learning_id: uuid.UUID,
    session: Session,
    user: Annotated[User, Depends(require_role(Role.LEAD, Role.DIRECTOR))],
    decision: Annotated[str, Query(pattern="^(verified|rejected)$")] = "verified",
) -> Learning:
    """A lead verifies (or rejects) a learning. Only verified ones are reused."""
    lr = await get_or_404(session, Learning, learning_id)
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
        await session.scalars(select(Project).order_by(Project.created_at))
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
