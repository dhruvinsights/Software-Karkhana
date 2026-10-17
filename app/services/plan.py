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

"""Turns the epics and stories drafted by the evaluation into project issues.

The evaluation writes ``epics`` and ``tasks`` rows. This copies them into
``issues`` (epic -> stories, linked by ``parent_id``) in the ``draft`` state, so
the team sees them in the same list as every other piece of work. Nothing
reaches the backlog until a lead approves the plan.

Syncing is idempotent: each epic and story maps to exactly one issue, so calling
it again updates titles rather than duplicating, and drafts whose source epic
was removed by a re-evaluation are dropped.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import dev_qa_rules, issue_rules, ledger, process
from app.models import Epic, Issue, Project, Task, User

# A story issue and its runnable task move together. People move the issue on
# the board (backlog, ready); runs, PRs and merges move the task.
_TASK_FOR_ISSUE = {"backlog": "backlog", "ready": "ready", "todo": "ready"}
_ISSUE_FOR_TASK = {"in_progress": "in_progress", "review": "in_review", "done": "ready_for_qa", "ready": "ready"}
_NOT_STARTED = frozenset({"draft", "backlog", "ready"})


@dataclass(frozen=True)
class SyncResult:
    """What a sync created and kept."""

    epics: int
    stories: int
    created: int
    removed: int


async def sync_plan(session: AsyncSession, project: Project, user: User) -> SyncResult:
    """Creates or refreshes draft issues for the project's epics and stories."""
    # Serialise numbering per project, as create_issue does.
    await session.execute(select(Project.id).where(Project.id == project.id).with_for_update())

    epics = list(
        (
            await session.scalars(
                select(Epic).where(Epic.project_id == project.id).order_by(Epic.position)
            )
        ).all()
    )
    tasks = list(
        (
            await session.scalars(
                select(Task).where(Task.project_id == project.id).order_by(Task.key)
            )
        ).all()
    )
    live_epics = {e.id for e in epics}
    live_tasks = {t.id for t in tasks}

    existing = list(
        (
            await session.scalars(
                select(Issue).where(Issue.project_id == project.id, Issue.source == "plan")
            )
        ).all()
    )
    by_epic = {i.epic_id: i for i in existing if i.type == "epic" and i.epic_id}
    by_task = {i.task_id: i for i in existing if i.type == "story" and i.task_id}

    # Drop drafts whose epic or story no longer exists. Approved work is kept.
    stale = [
        i.id
        for i in existing
        if i.status == "draft"
        and (
            (i.type == "epic" and i.epic_id not in live_epics)
            or (i.type == "story" and i.task_id not in live_tasks)
        )
    ]
    if stale:
        await session.execute(delete(Issue).where(Issue.id.in_(stale)))
        for i in existing:
            if i.id in stale:
                by_epic.pop(i.epic_id, None)
                by_task.pop(i.task_id, None)

    number = await session.scalar(
        select(func.coalesce(func.max(Issue.number), 0)).where(Issue.project_id == project.id)
    )
    created = 0

    def _new(**kw) -> Issue:
        nonlocal number, created
        number += 1
        created += 1
        issue = Issue(
            id=uuid.uuid4(),
            project_id=project.id,
            number=number,
            reporter_id=user.id,
            priority="P2",
            status="draft",
            source="plan",
            **kw,
        )
        session.add(issue)
        return issue

    epic_issue: dict[uuid.UUID, Issue] = {}
    for e in epics:
        issue = by_epic.get(e.id)
        if issue is None:
            issue = _new(
                title=e.title[:200],
                description=e.description,
                type="epic",
                epic_id=e.id,
                source_quote=e.source_quote,
                labels=["plan"],
            )
        elif issue.status == "draft":
            issue.title = e.title[:200]
            issue.description = e.description
            issue.source_quote = e.source_quote
            issue.updated_at = dt.datetime.now(dt.UTC)
        epic_issue[e.id] = issue
    await session.flush()

    for t in tasks:
        issue = by_task.get(t.id)
        parent = epic_issue.get(t.epic_id)
        if issue is None:
            issue = _new(
                title=t.title[:200],
                description=t.description,
                type="story",
                task_id=t.id,
                epic_id=t.epic_id,
                parent_id=parent.id if parent else None,
                acceptance_criteria=list(t.acceptance_criteria or []),
                assignee_id=t.assignee_id,
                labels=["plan", *([f"layer:{layer}"] if (layer := dev_qa_rules.layer_of(None, t.description)) else [])],
            )
        elif issue.status == "draft":
            issue.title = t.title[:200]
            issue.acceptance_criteria = list(t.acceptance_criteria or [])
            issue.parent_id = parent.id if parent else None
            issue.updated_at = dt.datetime.now(dt.UTC)
        # One id per story everywhere (board, branch, PR, design): the issue key.
        t.key = issue_rules.key(issue.number)
    await session.flush()

    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="plan.synced",
        subject_type="project",
        subject_id=project.id,
        project_id=project.id,
        payload={"epics": len(epics), "stories": len(tasks), "created": created, "removed": len(stale)},
    )
    return SyncResult(epics=len(epics), stories=len(tasks), created=created, removed=len(stale))


async def task_follows_issue(session: AsyncSession, issue: Issue) -> None:
    """A person moved a story on the board: its task follows, before work starts."""
    target = _TASK_FOR_ISSUE.get(issue.status)
    if issue.task_id is None or target is None:
        return
    task = await session.get(Task, issue.task_id)
    if task is not None and task.status in _NOT_STARTED:
        task.status = target


async def move_task(session: AsyncSession, task: Task, status: str) -> None:
    """Moves a task (legal moves only) and the story issue linked to it."""
    process.move_task(task, status)
    target = _ISSUE_FOR_TASK.get(status)
    if target is None:
        return
    issue = await session.scalar(select(Issue).where(Issue.task_id == task.id, Issue.type == "story"))
    if issue is not None and issue.status != target:
        issue.status = target
        issue.updated_at = dt.datetime.now(dt.UTC)


async def approve_plan(session: AsyncSession, project: Project) -> int:
    """Moves every draft plan issue, and its task, to the backlog. Returns how many moved."""
    now = dt.datetime.now(dt.UTC)
    rows = list(
        (
            await session.scalars(
                select(Issue)
                .where(
                    Issue.project_id == project.id,
                    Issue.source == "plan",
                    Issue.status == "draft",
                )
                .with_for_update()
            )
        ).all()
    )
    for i in rows:
        i.status = "backlog"
        i.updated_at = now
        await task_follows_issue(session, i)
    await session.flush()
    return len(rows)
