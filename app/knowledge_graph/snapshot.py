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
"""Reads one project's slice of Postgres into plain rows for the projector.

Kept separate from the graph writer so the writer can be tested without a
database, and so the only thing that ever *reads the record* is this module.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Adr,
    Epic,
    Issue,
    Learning,
    Product,
    Project,
    PullRequest,
    Run,
    SecurityFinding,
    Task,
    TestScenario,
)

Row = dict[str, Any]


@dataclass
class ProjectSnapshot:
    """Everything the graph needs about one project, as JSON-safe rows."""

    project: Row
    product: Row | None
    epics: list[Row] = field(default_factory=list)
    tasks: list[Row] = field(default_factory=list)
    runs: list[Row] = field(default_factory=list)
    prs: list[Row] = field(default_factory=list)
    adrs: list[Row] = field(default_factory=list)
    issues: list[Row] = field(default_factory=list)
    findings: list[Row] = field(default_factory=list)
    learnings: list[Row] = field(default_factory=list)
    scenarios: list[Row] = field(default_factory=list)
    # Component names known anywhere in the product, so a task here can match
    # an ADR written in a sibling project.
    vocabulary: list[str] = field(default_factory=list)

    @property
    def workspace_id(self) -> str | None:
        """The owning workspace, or None for single-tenant projects."""
        return self.project.get("workspace_id")

    @property
    def scope(self) -> str:
        """Components are shared per product (or per project when there is none)."""
        return self.product["id"] if self.product else self.project["id"]


def norm_component(name: str) -> str:
    """Canonical component name: lowercase, single spaces."""
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def component_id(scope: str, name: str) -> str:
    """Stable graph id of a component within its product (or project) scope."""
    return f"{scope}:{norm_component(name)}"


def mentions(text: str, vocabulary: list[str]) -> list[str]:
    """Components named in ``text`` (whole-word, case-insensitive)."""
    low = (text or "").lower()
    found = []
    for name in vocabulary:
        n = norm_component(name)
        if n and re.search(rf"(?<![\w-]){re.escape(n)}(?![\w-])", low):
            found.append(n)
    return found


def _s(v: Any) -> Any:
    if isinstance(v, uuid.UUID):
        return str(v)
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def _row(obj: Any, cols: tuple[str, ...]) -> Row:
    return {c: _s(getattr(obj, c)) for c in cols}


async def load(session: AsyncSession, project_id: uuid.UUID) -> ProjectSnapshot | None:
    """Loads a project's slice, or ``None`` if it no longer exists or is archived."""
    project = await session.get(Project, project_id)
    if project is None or project.archived_at is not None:
        return None
    product = await session.get(Product, project.product_id) if project.product_id else None

    async def all_(stmt):
        return (await session.scalars(stmt)).all()

    tasks = await all_(select(Task).where(Task.project_id == project_id))
    task_ids = [t.id for t in tasks]
    prs = await all_(select(PullRequest).where(PullRequest.task_id.in_(task_ids))) if task_ids else []

    # Product-wide component vocabulary.
    scope_projects = (
        select(Project.id).where(Project.product_id == product.id)
        if product
        else select(Project.id).where(Project.id == project_id)
    )
    vocab: set[str] = set()
    for comps in await all_(select(Adr.affected_components).where(Adr.project_id.in_(scope_projects))):
        vocab.update(norm_component(c) for c in comps or [])
    for c in await all_(select(SecurityFinding.affected_component).where(SecurityFinding.project_id.in_(scope_projects))):
        if c:
            vocab.add(norm_component(c))
    vocab.discard("")

    learnings = []
    for lr in await all_(select(Learning).where(Learning.project_id == project_id)):
        row = _row(lr, ("id", "pr_id", "text", "status", "embedding_model", "created_at"))
        row["embedding"] = [float(x) for x in lr.embedding] if lr.embedding is not None else None
        learnings.append(row)

    return ProjectSnapshot(
        project=_row(project, ("id", "product_id", "workspace_id", "name", "stage", "stage_status")),
        product=_row(product, ("id", "name", "code", "domain")) if product else None,
        epics=[_row(e, ("id", "title")) for e in await all_(select(Epic).where(Epic.project_id == project_id))],
        tasks=[
            {**_row(t, ("id", "epic_id", "key", "title", "description", "status")),
             "criteria": "\n".join(t.acceptance_criteria or [])}
            for t in tasks
        ],
        runs=[
            _row(r, ("id", "task_id", "kind", "status", "test_exit_code", "validation_status", "finished_at"))
            for r in await all_(select(Run).where(Run.project_id == project_id))
        ],
        prs=[
            _row(p, ("id", "task_id", "run_id", "number", "url", "status", "tests_passed", "merged_at"))
            for p in prs
        ],
        adrs=[
            {**_row(a, ("id", "number", "title", "status", "context", "decision", "rationale")),
             "components": [norm_component(c) for c in a.affected_components or [] if c]}
            for a in await all_(select(Adr).where(Adr.project_id == project_id))
        ],
        issues=[
            _row(i, ("id", "number", "title", "description", "type", "priority", "status",
                     "task_id", "pr_id", "epic_id", "created_at", "closed_at"))
            for i in await all_(select(Issue).where(Issue.project_id == project_id))
        ],
        findings=[
            _row(f, ("id", "title", "cve_id", "cwe_category", "severity", "status",
                     "affected_component", "sla_deadline"))
            for f in await all_(select(SecurityFinding).where(SecurityFinding.project_id == project_id))
        ],
        learnings=learnings,
        scenarios=[
            _row(s, ("id", "issue_id", "title", "type", "status"))
            for s in await all_(select(TestScenario).where(TestScenario.project_id == project_id))
        ],
        vocabulary=sorted(vocab),
    )
