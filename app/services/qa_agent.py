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

"""The QA agent: reads a finished story's change and suggests bugs. It files none.

Inputs: the story and its acceptance criteria, the diff that implemented it,
the results QA already recorded, and the repository snapshot. Output: typed
suggestions. Code keeps the agent honest:

* every suggestion cites a file from the diff or the repository (an invented
  path drops the suggestion);
* titles already suggested, or already filed as bugs, are skipped.

A QA engineer then accepts a suggestion (it becomes a bug assigned to the
developer) or dismisses it with a reason.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import llm
from app.db import sessionmaker
from app.models import (
    Issue,
    Project,
    PullRequest,
    QaSuggestion,
    RepoSnapshot,
    Run,
    TestScenario,
)
from app.services import repo_context
from app.services.realtime import notify_workspace

logger = logging.getLogger(__name__)


class Evidence(BaseModel):
    """Where in the code the problem is."""

    path: str = Field(
        description="A file path from the DIFF or the REPOSITORY tree, copied exactly."
    )
    line: int | None = None
    note: str = Field(default="", description="What in this place causes the problem.")


class Suggestion(BaseModel):
    """One probable bug."""

    title: str = Field(description="What is wrong, under 100 characters.")
    description: str = Field(description="Why it is a bug and what a user would see.")
    category: Literal[
        "functional", "edge_case", "security", "data", "performance", "error_handling"
    ]
    severity: Literal["P0", "P1", "P2", "P3"]
    steps: list[str] = Field(
        min_length=1, max_length=8, description="How a tester reproduces it."
    )
    expected: str = Field(description="What should happen instead.")
    evidence: list[Evidence] = Field(min_length=1, max_length=4)


class Suggestions(BaseModel):
    """What the agent returns; an empty list is a valid answer."""

    suggestions: list[Suggestion] = Field(max_length=8)


SYSTEM = """\
You are a senior QA engineer reviewing one finished story before it ships.
Find real, probable bugs in the change: acceptance criteria it does not meet,
missed edge cases and boundaries, missing validation, error handling, security
and data problems. For each, cite the file (and line when you can) from the DIFF
or the REPOSITORY tree where the problem is, and give steps a tester can follow
by hand to confirm it.
Rules:
- Only problems you can tie to the code you were shown. No style remarks,
  no "consider adding tests", no speculation about code you did not see.
- A human QA engineer decides on every suggestion; say plainly how sure you are
  in the description.
- Return fewer suggestions rather than weak ones; none is a valid answer.
"""

_DIFF_FILE = re.compile(r"^\+\+\+ b/(.+)$", re.MULTILINE)


def _norm(path: str) -> str:
    return path.strip().strip("`").removeprefix("./").lstrip("/").split(":", 1)[0]


def diff_paths(patch: str) -> set[str]:
    """Files the diff touches."""
    return {_norm(p) for p in _DIFF_FILE.findall(patch or "")}


def grounded(
    items: list[Suggestion], patch: str, snapshot: RepoSnapshot | None, taken: set[str]
) -> tuple[list[Suggestion], int]:
    """Keeps suggestions that cite real files and are not duplicates; returns them and how many were dropped."""
    in_diff = diff_paths(patch)
    kept: list[Suggestion] = []
    dropped = 0
    seen = {t.casefold() for t in taken}
    for s in items:
        real = [
            e
            for e in s.evidence
            if _norm(e.path) in in_diff
            or (snapshot is not None and repo_context.known_path(snapshot, e.path))
        ]
        key = s.title.strip().casefold()
        if not real or key in seen:
            dropped += 1
            continue
        seen.add(key)
        kept.append(s.model_copy(update={"evidence": real}))
    return kept, dropped


async def _change_for(session: AsyncSession, story: Issue) -> str:
    """The latest successful run's diff for the story (merged or still in review)."""
    if story.task_id is None:
        return ""
    patch = await session.scalar(
        select(Run.patch)
        .join(PullRequest, PullRequest.run_id == Run.id)
        .where(PullRequest.task_id == story.task_id)
        .order_by(PullRequest.number.desc())
        .limit(1)
    )
    return (patch or "")[:60_000]


async def _set(
    session: AsyncSession, story: Issue, project: Project, **values: Any
) -> None:
    story.qa_agent = {**(story.qa_agent or {}), **values}
    await session.commit()
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "projects")


async def run(story_id: uuid.UUID) -> None:
    """Background job: suggest bugs for one story."""
    async with sessionmaker()() as session:
        story = await session.get(Issue, story_id)
        project = await session.get(Project, story.project_id) if story else None
        if story is None or project is None:
            return
        try:
            await _set(session, story, project, step="Reading the change and the code")
            patch = await _change_for(session, story)
            snapshot = (
                await repo_context.latest(session, project.product_id)
                if project.product_id
                else None
            )
            if not patch and snapshot is None:
                raise ValueError(
                    "There is no change or code for this story yet; build it first."
                )
            results = (
                await session.scalars(
                    select(TestScenario).where(TestScenario.issue_id == story.id)
                )
            ).all()
            taken = set(
                (
                    await session.scalars(
                        select(QaSuggestion.title).where(
                            QaSuggestion.issue_id == story.id
                        )
                    )
                ).all()
            ) | set(
                (
                    await session.scalars(
                        select(Issue.title).where(
                            Issue.parent_id == story.id, Issue.type == "bug"
                        )
                    )
                ).all()
            )
            criteria = (
                "\n".join(f"- {c}" for c in story.acceptance_criteria or [])
                or "- (none written)"
            )
            recorded = (
                "\n".join(
                    f"- [{t.status}] {t.title}: expected {t.expected_result}; actual {t.actual_result or 'n/a'}"
                    for t in results
                )
                or "- (no scenarios run yet)"
            )
            prompt = (
                f"PROJECT: {project.name}\nSTORY: {story.title}\n{story.description}\n\n"
                f"ACCEPTANCE CRITERIA:\n{criteria}\n\nQA RESULTS SO FAR:\n{recorded}\n\n"
                f"ALREADY REPORTED (do not repeat):\n"
                + ("\n".join(f"- {t}" for t in taken) or "- none")
                + "\n\n"
                f"DIFF:\n{patch or '(not available)'}\n\n"
                + (
                    repo_context.render(snapshot, 50_000)
                    if snapshot
                    else "REPOSITORY: not scanned."
                )
            )
            await _set(session, story, project, step="Looking for bugs")
            out = await llm.generate_structured(
                prompt=prompt, schema=Suggestions, system=SYSTEM, timeout_s=600
            )
            kept, dropped = grounded(out.suggestions, patch, snapshot, taken)
            model = llm.chat_model_name()
            for s in kept:
                session.add(
                    QaSuggestion(
                        id=uuid.uuid4(),
                        project_id=project.id,
                        issue_id=story.id,
                        title=s.title.strip()[:200],
                        description=s.description,
                        category=s.category,
                        severity=s.severity,
                        steps=s.steps,
                        expected=s.expected,
                        evidence=[e.model_dump() for e in s.evidence],
                        model=model,
                    )
                )
            await _set(
                session,
                story,
                project,
                state="ready",
                step=None,
                suggested=len(kept),
                dropped=dropped,
                error=None,
                finishedAt=dt.datetime.now(dt.UTC).isoformat(),
            )
        except Exception as exc:  # the job reports every failure on the story
            logger.warning("QA agent failed for %s: %s", story_id, exc)
            await session.rollback()
            story = await session.get(Issue, story_id)
            if story is not None:
                await _set(
                    session,
                    story,
                    project,
                    state="failed",
                    step=None,
                    error=str(exc)[:500],
                )
