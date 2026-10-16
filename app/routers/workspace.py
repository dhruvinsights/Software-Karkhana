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

"""Role-scoped navigation, dashboards and system health.

The server decides what each role may see, so the sidebar can never drift from
what the API allows. Every number is a SQL count over real rows.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import shutil
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.providers import gemini, ollama
from app import access
from app.auth import CurrentUser
from app.config import get_settings
from app.db import get_session
from app.models import (
    Learning,
    LedgerEntry,
    Project,
    PullRequest,
    ReviewComment,
    Run,
    Task,
    User,
)
from app.process import Role

router = APIRouter(prefix="/api", tags=["workspace"])
Session = Annotated[AsyncSession, Depends(get_session)]

# (path, label, icon key, roles allowed). The first entry a role may open is its home.
PAGES: list[tuple[str, str, str, frozenset[Role]]] = [
    ("/home", "Overview", "home", frozenset(Role)),
    (
        "/ideas",
        "Ideas",
        "idea",
        frozenset({Role.PM, Role.DIRECTOR}),
    ),
    ("/approvals", "Approvals", "gate", frozenset({Role.DIRECTOR})),
    (
        "/work",
        "My work",
        "code",
        frozenset({Role.DEVELOPER, Role.LEAD}),
    ),
    (
        "/reviews",
        "PR reviews",
        "review",
        frozenset({Role.DEVELOPER, Role.LEAD}),
    ),
    (
        "/portfolio",
        "Portfolio",
        "chart",
        frozenset({Role.DIRECTOR, Role.LEAD, Role.PM}),
    ),
    ("/learnings", "Learnings", "book", frozenset(Role)),
    ("/ledger", "Ledger", "ledger", frozenset({Role.DIRECTOR, Role.LEAD})),
    ("/system", "System", "system", frozenset({Role.LEAD, Role.DIRECTOR})),
]


@router.post("/me/onboarded")
async def finish_onboarding(user: CurrentUser, session: Session) -> dict[str, Any]:
    """Marks first-run onboarding done for the signed-in user."""
    if user.onboarded_at is None:
        user.onboarded_at = dt.datetime.now(dt.UTC)
        session.add(user)
    return {"onboarded_at": user.onboarded_at}


@router.get("/public/stats")
async def public_stats(session: Session) -> dict[str, int]:
    """Aggregate counts for the landing page. No names, no content."""
    return {
        "projects": await _count(session, select(func.count()).select_from(Project)),
        "merged_prs": await _count(
            session,
            select(func.count())
            .select_from(PullRequest)
            .where(PullRequest.status == "merged"),
        ),
        "agent_runs": await _count(session, select(func.count()).select_from(Run)),
        "ledger_entries": await _count(
            session, select(func.count()).select_from(LedgerEntry)
        ),
    }


@router.get("/public/dev-users")
async def dev_users(session: Session) -> list[dict[str, str]]:
    """Accounts the local sign-in picker offers. Empty outside AUTH_MODE=dev."""
    if get_settings().auth_mode != "dev":
        return []
    users = (await session.scalars(select(User).order_by(User.role, User.email))).all()
    return [{"email": u.email, "name": u.display_name, "role": u.role} for u in users]


@router.get("/nav")
async def nav(user: CurrentUser, session: Session) -> dict[str, Any]:
    """The pages this role may open (UI only; the API checks every action)."""
    role = _display(await access.display_role(session, user))
    return {
        "role": role.value,
        "pages": [
            {"path": p, "label": label, "icon": icon}
            for p, label, icon, roles in PAGES
            if role in roles
        ],
    }


def _display(role: str) -> Role:
    try:
        return Role(role)
    except ValueError:
        return Role(access.DEFAULT_ACCOUNT_ROLE)


async def _count(session: AsyncSession, query: Select[tuple[int]]) -> int:
    return int(await session.scalar(query) or 0)


@router.get("/dashboard")
async def dashboard(session: Session, user: CurrentUser) -> dict[str, Any]:
    """Counts and work queues for the caller's role. Nothing else leaks in."""
    role = _display(await access.display_role(session, user))
    projects = select(func.count()).select_from(Project)
    out: dict[str, Any] = {
        "role": role.value,
        "user": user.display_name,
        "stats": [],
        "queues": {},
    }

    def stat(label: str, value: int, hint: str = "") -> None:
        out["stats"].append({"label": label, "value": value, "hint": hint})

    def rows(items) -> list[dict[str, Any]]:
        return [
            {
                "id": str(p.id),
                "name": p.name,
                "stage": p.stage,
                "status": p.stage_status,
            }
            for p in items
        ]

    if role is Role.PM:
        mine = Project.created_by == user.id
        stat("My ideas", await _count(session, projects.where(mine)))
        stat(
            "Evaluating",
            await _count(
                session, projects.where(mine, Project.stage_status == "submitted")
            ),
        )
        stat(
            "Awaiting director",
            await _count(
                session, projects.where(mine, Project.stage_status == "evaluated")
            ),
        )
        stat(
            "Rejected",
            await _count(
                session, projects.where(mine, Project.stage_status == "rejected")
            ),
            "Refine and resubmit",
        )
        out["queues"]["Needs your attention"] = rows(
            (
                await session.scalars(
                    select(Project)
                    .where(mine, Project.stage_status == "rejected")
                    .order_by(Project.updated_at.desc())
                    .limit(8)
                )
            ).all()
        )
        out["queues"]["Recent ideas"] = rows(
            (
                await session.scalars(
                    select(Project)
                    .where(mine)
                    .order_by(Project.created_at.desc())
                    .limit(8)
                )
            ).all()
        )
    elif role is Role.DIRECTOR:
        stat(
            "Awaiting your decision",
            await _count(session, projects.where(Project.stage_status == "evaluated")),
        )
        stat(
            "In delivery",
            await _count(
                session,
                projects.where(
                    Project.stage.in_(["plan", "implement", "pr", "review"])
                ),
            ),
        )
        stat("All projects", await _count(session, projects))
        stat(
            "Merged PRs",
            await _count(
                session,
                select(func.count())
                .select_from(PullRequest)
                .where(PullRequest.status == "merged"),
            ),
        )
        out["queues"]["Approve or reject"] = rows(
            (
                await session.scalars(
                    select(Project)
                    .where(Project.stage_status == "evaluated")
                    .order_by(Project.updated_at.desc())
                    .limit(10)
                )
            ).all()
        )
    else:  # developer, lead
        stat(
            "Ready to build",
            await _count(
                session,
                select(func.count()).select_from(Task).where(Task.status == "ready"),
            ),
        )
        stat(
            "In progress",
            await _count(
                session,
                select(func.count())
                .select_from(Task)
                .where(Task.status == "in_progress"),
            ),
        )
        stat(
            "Untriaged AI comments",
            await _count(
                session,
                select(func.count())
                .select_from(ReviewComment)
                .join(PullRequest, PullRequest.id == ReviewComment.pr_id)
                .where(ReviewComment.triage == "open", PullRequest.status == "open"),
            ),
        )
        stat(
            "My runs",
            await _count(
                session,
                select(func.count())
                .select_from(Run)
                .where(Run.requested_by == user.id),
            ),
        )
        if role is Role.LEAD:
            stat(
                "Learnings to verify",
                await _count(
                    session,
                    select(func.count())
                    .select_from(Learning)
                    .where(Learning.status == "unverified"),
                ),
            )
        ready = (
            await session.execute(
                select(Task, Project)
                .join(Project, Project.id == Task.project_id)
                .where(Task.status == "ready")
                .order_by(Task.created_at)
                .limit(10)
            )
        ).all()
        out["queues"]["Ready for the agent"] = [
            {
                "id": str(t.id),
                "project_id": str(p.id),
                "name": f"{t.key}: {t.title}",
                "stage": p.name,
                "status": t.status,
            }
            for t, p in ready
        ]
    return out


@router.get("/work")
async def work(session: Session, _: CurrentUser) -> list[dict[str, Any]]:
    """Approved stories that are not done yet, newest project first."""
    rows = (
        await session.execute(
            select(Task, Project)
            .join(Project, Project.id == Task.project_id)
            .where(Task.status.in_(["ready", "in_progress", "review"]))
            .order_by(Project.created_at.desc(), Task.key)
            .limit(200)
        )
    ).all()
    return [
        {
            "id": str(t.id),
            "key": t.key,
            "title": t.title,
            "status": t.status,
            "criteria": len(t.acceptance_criteria),
            "project_id": str(p.id),
            "project_name": p.name,
        }
        for t, p in rows
    ]


@router.get("/prs")
async def pull_requests(
    session: Session, _: CurrentUser, status: str | None = None
) -> list[dict[str, Any]]:
    """Pull requests opened by agent runs, with how much review work is left."""
    open_comments = (
        select(func.count())
        .select_from(ReviewComment)
        .where(ReviewComment.pr_id == PullRequest.id, ReviewComment.triage == "open")
        .scalar_subquery()
    )
    total_comments = (
        select(func.count())
        .select_from(ReviewComment)
        .where(ReviewComment.pr_id == PullRequest.id)
        .scalar_subquery()
    )
    query = (
        select(PullRequest, Task, Project, open_comments, total_comments)
        .join(Task, Task.id == PullRequest.task_id)
        .join(Project, Project.id == Task.project_id)
        .join(Run, Run.id == PullRequest.run_id)
        .order_by(Run.created_at.desc())
        .limit(100)
    )
    if status:
        query = query.where(PullRequest.status == status)
    return [
        {
            "id": str(pr.id),
            "number": pr.number,
            "url": pr.url,
            "branch": pr.branch,
            "status": pr.status,
            "tests_passed": pr.tests_passed,
            "reviewed": pr.reviewed_at is not None,
            "review_engine": pr.review_engine,
            "open_comments": int(opened or 0),
            "total_comments": int(total or 0),
            "task_id": str(t.id),
            "task_key": t.key,
            "task_title": t.title,
            "project_id": str(p.id),
            "project_name": p.name,
        }
        for pr, t, p, opened, total in (await session.execute(query)).all()
    ]


@router.get("/providers/health")
async def providers_health(_: CurrentUser) -> dict[str, Any]:
    """Which model providers and engines are actually reachable right now."""
    s = get_settings()
    ollama_info = await ollama.health()
    review_py = s.pr_agent_python
    pr_agent_ok = bool(review_py) and await asyncio.to_thread(Path(review_py).exists)
    return {
        "llm_provider": s.llm_provider,
        "embed_provider": s.embed_provider,
        "chat_model": s.ollama_model if s.llm_provider == "ollama" else s.gemini_model,
        "embed_model": s.ollama_embed_model
        if s.embed_provider == "ollama"
        else s.embedding_model,
        "gemini": {"configured": gemini.configured()},
        "ollama": {"base_url": s.ollama_base_url, **ollama_info},
        "review": {
            "engine": s.review_engine,
            "pr_agent_ready": pr_agent_ok,
        },
    }


@router.get("/runner/status")
async def runner_status(_: CurrentUser) -> dict[str, Any]:
    """The configured runner, with the real reason when it cannot run."""
    s = get_settings()
    info: dict[str, Any] = {"backend": s.runner_backend, "ready": True, "detail": ""}
    if s.runner_backend == "ax":
        ax = await asyncio.to_thread(shutil.which, s.ax_bin)
        kubectl = await asyncio.to_thread(shutil.which, "kubectl")
        info["ready"] = bool(ax and kubectl)
        info["detail"] = (
            "ax CLI and kubectl found; cluster reachability is checked when a run starts."
            if info["ready"]
            else "Missing: "
            + ", ".join(n for n, p in (("ax", ax), ("kubectl", kubectl)) if not p)
        )
    elif s.runner_backend == "local":
        info["detail"] = "Runs the worker as a subprocess of the API."
    else:
        info["detail"] = f"Cloud Run Job {s.worker_job_name}."
    return info
