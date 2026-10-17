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

"""From an approved idea to a reviewable plan: PRD, ERD, epics and stories.

One background job per project, three model calls:

1. **PRD** from the idea, its evaluation report and the repository.
2. **ERD** and 3. **backlog**, in parallel, from the PRD and the repository.

Code holds the model to the plan's own structure:

* requirement ids are unique and well-formed (``FR-n``, ``NFR-n``);
* every story cites requirement ids that exist, and every "Must" requirement
  is covered by at least one story;
* ERD relations join entities that exist, and an entity marked "existing"
  must appear in the code.

Each failed check gets one repair pass. The documents are stored as version 1
drafts, the backlog becomes draft issues, and a person approves the plan.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import re
import uuid
from typing import Any, Literal, TypeVar

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import ledger, process
from app.ai import llm
from app.ai.errors import ModelError
from app.db import sessionmaker
from app.models import (
    Epic,
    Idea,
    Product,
    Project,
    ProjectDocument,
    RepoSnapshot,
    Task,
    User,
)
from app.services import plan, repo_context
from app.services.realtime import notify_workspace

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

# ── Schemas ───────────────────────────────────────────────────────────────────


class Requirement(BaseModel):
    """A functional requirement."""

    id: str = Field(pattern=r"^FR-\d+$")
    title: str
    description: str
    priority: Literal["Must", "Should", "Could"]
    acceptance_criteria: list[str] = Field(min_length=1, max_length=6)


class Quality(BaseModel):
    """A non-functional requirement."""

    id: str = Field(pattern=r"^NFR-\d+$")
    category: Literal["Performance", "Security", "Reliability", "Usability", "Maintainability", "Compliance"]
    requirement: str


class Persona(BaseModel):
    """Who the product serves in this change."""

    name: str
    needs: str


class Journey(BaseModel):
    """A user journey, step by step."""

    name: str
    steps: list[str] = Field(min_length=2, max_length=10)


class Prd(BaseModel):
    """Product requirements document."""

    summary: str = Field(description="Three to five sentences.")
    problem: str
    goals: list[str] = Field(min_length=1, max_length=6)
    non_goals: list[str] = Field(max_length=6)
    personas: list[Persona] = Field(min_length=1, max_length=4)
    journeys: list[Journey] = Field(min_length=1, max_length=4)
    functional: list[Requirement] = Field(min_length=2, max_length=15)
    non_functional: list[Quality] = Field(max_length=8)
    success_metrics: list[str] = Field(min_length=1, max_length=6)
    dependencies: list[str]
    risks: list[str]
    open_questions: list[str]
    milestones: list[str] = Field(min_length=1, max_length=6)


class Column(BaseModel):
    """One column of an entity."""

    name: str
    type: str
    key: Literal["PK", "FK", ""] = ""
    nullable: bool = False
    note: str = ""


class Entity(BaseModel):
    """A table or document type."""

    name: str = Field(pattern=r"^[a-z][a-z0-9_]*$", description="Table name, snake_case.")
    status: Literal["existing", "changed", "new"]
    description: str
    columns: list[Column] = Field(min_length=1)


class Relation(BaseModel):
    """A relationship between two entities."""

    source: str
    target: str
    cardinality: Literal["one-to-one", "one-to-many", "many-to-many"]
    label: str


class Erd(BaseModel):
    """Entity-relationship design for the change."""

    entities: list[Entity] = Field(min_length=1, max_length=20)
    relations: list[Relation]
    notes: list[str] = Field(description="Migrations, indexes, constraints worth calling out.")


class Story(BaseModel):
    """A user story with testable acceptance criteria."""

    title: str = Field(description="As a <user>, I want <goal> so that <benefit>.")
    acceptance_criteria: list[str] = Field(min_length=2, max_length=6, description="Given/When/Then.")
    requirement_ids: list[str] = Field(min_length=1)
    estimate: Literal[1, 2, 3, 5, 8]
    layer: Literal["backend", "frontend", "data", "test", "docs", "devops"]


class BacklogEpic(BaseModel):
    """An epic and its stories."""

    title: str
    description: str
    stories: list[Story] = Field(min_length=1, max_length=8)


class Backlog(BaseModel):
    """Epics and stories for the PRD."""

    epics: list[BacklogEpic] = Field(min_length=1, max_length=6)


# ── Prompts ───────────────────────────────────────────────────────────────────

_RULES = """\
Rules:
- Ground every statement in the inputs. The repository section is the truth
  about what exists today; build on it instead of re-inventing it.
- Never invent customers, numbers or dates. Unknowns go to open questions.
- Plain sentences for engineers and product managers. No Markdown syntax.
"""

PRD_SYSTEM = (
    "You are a senior product manager writing the PRD for one approved change "
    "to an existing product. Number functional requirements FR-1, FR-2, ... and "
    "non-functional ones NFR-1, NFR-2, ... Keep scope to what the approved idea "
    "and its evaluation describe.\n" + _RULES
)
ERD_SYSTEM = (
    "You are a data architect. Describe the data model this PRD needs: mark "
    "tables that already exist in the code as 'existing', tables you modify as "
    "'changed', and new ones as 'new'. Use the real table names from the code.\n" + _RULES
)
BACKLOG_SYSTEM = (
    "You are a tech lead turning a PRD into epics and user stories that one "
    "developer can each finish in a few days. Every story cites the requirement "
    "ids it delivers. Every 'Must' requirement needs at least one story. "
    "Include test work inside stories rather than as separate test-only epics.\n" + _RULES
)

# ── Checks ────────────────────────────────────────────────────────────────────


def check_prd(prd: Prd) -> list[str]:
    """Duplicate ids make stories ambiguous."""
    problems: list[str] = []
    for label, ids in (("FR", [r.id for r in prd.functional]), ("NFR", [q.id for q in prd.non_functional])):
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            problems.append(f"Duplicate {label} ids: {', '.join(dupes)}.")
    if not any(r.priority == "Must" for r in prd.functional):
        problems.append("No functional requirement is a 'Must'; mark the core ones.")
    return problems


def check_backlog(backlog: Backlog, prd: Prd) -> list[str]:
    """Stories trace to real requirements and cover every Must."""
    known = {r.id for r in prd.functional} | {q.id for q in prd.non_functional}
    cited: set[str] = set()
    problems: list[str] = []
    for epic in backlog.epics:
        for story in epic.stories:
            unknown = [i for i in story.requirement_ids if i not in known]
            if unknown:
                problems.append(f"Story '{story.title[:60]}' cites unknown ids: {', '.join(unknown)}.")
            cited.update(story.requirement_ids)
    uncovered = [r.id for r in prd.functional if r.priority == "Must" and r.id not in cited]
    if uncovered:
        problems.append(f"No story delivers these Must requirements: {', '.join(uncovered)}.")
    return problems


def _code_text(snapshot: RepoSnapshot | None) -> str:
    return "\n".join(snapshot.files.values()).lower() if snapshot else ""


def check_erd(erd: Erd, snapshot: RepoSnapshot | None) -> list[str]:
    """Relations join known entities; 'existing' entities are really in the code."""
    names = {e.name for e in erd.entities}
    problems = [
        f"Relation {r.source} -> {r.target} names an entity that is not listed."
        for r in erd.relations
        if r.source not in names or r.target not in names
    ]
    code = _code_text(snapshot)
    if code:
        for e in erd.entities:
            if e.status == "existing" and not re.search(rf"\b{re.escape(e.name)}\b", code):
                problems.append(f"Entity '{e.name}' is marked existing but does not appear in the code.")
    return problems


async def _generate(schema: type[T], system: str, prompt: str, check: Any) -> T:
    """One structured call plus one repair pass if ``check`` finds problems."""
    out = await llm.generate_structured(prompt=prompt, schema=schema, system=system, timeout_s=600)
    problems = check(out)
    if not problems:
        return out
    logger.info("%s repair pass: %s", schema.__name__, problems)
    out = await llm.generate_structured(
        prompt=f"{prompt}\n\nYOUR PREVIOUS ANSWER WAS REJECTED:\n- "
        + "\n- ".join(problems)
        + f"\n\nPrevious answer:\n{out.model_dump_json()}\n\nReturn the corrected answer.",
        schema=schema,
        system=system,
        temperature=0.1,
        timeout_s=600,
    )
    problems = check(out)
    if problems:
        raise ModelError(f"{schema.__name__} failed its checks twice: " + "; ".join(problems))
    return out


# ── Rendering helpers used by the API ─────────────────────────────────────────


def mermaid(erd: dict[str, Any]) -> str:
    """The ERD as a Mermaid ``erDiagram`` (rendered in the browser)."""
    arrows = {"one-to-one": "||--||", "one-to-many": "||--o{", "many-to-many": "}o--o{"}
    lines = ["erDiagram"]
    for e in erd["entities"]:
        lines.append(f"    {e['name']} {{")
        for c in e["columns"]:
            key = f" {c['key']}" if c.get("key") else ""
            ctype = re.sub(r"[^A-Za-z0-9_]", "_", c["type"]) or "text"
            lines.append(f"        {ctype} {c['name']}{key}")
        lines.append("    }")
    for r in erd["relations"]:
        label = r["label"].replace('"', "'")
        lines.append(f'    {r["source"]} {arrows[r["cardinality"]]} {r["target"]} : "{label}"')
    return "\n".join(lines)


# ── Job ───────────────────────────────────────────────────────────────────────


async def _set_status(session: AsyncSession, project: Project, **status: Any) -> None:
    project.docs_status = {**(project.docs_status or {}), **status}
    await session.commit()
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "projects")


def _context(project: Project, idea: Idea | None, product: Product | None, code: str) -> str:
    report = (idea.review_report or {}).get("report") if idea else None
    return (
        f"PRODUCT: {product.name if product else '(none)'}\n{product.description if product else ''}\n\n"
        f"PROJECT: {project.name}\n\n"
        f"APPROVED IDEA:\n{project.idea_text}\n\n"
        f"EVALUATION REPORT (approved by reviewers):\n{json.dumps(report) if report else '(none)'}\n\n"
        f"{code}"
    )


async def _store_backlog(session: AsyncSession, project: Project, backlog: Backlog) -> int:
    """Writes epics and stories as drafts (``epics``/``tasks``), numbered per project."""
    start = await session.scalar(select(func.count()).select_from(Task).where(Task.project_id == project.id))
    n = start or 0
    for pos, ep in enumerate(backlog.epics):
        ids = sorted({i for s in ep.stories for i in s.requirement_ids})
        epic = Epic(
            id=uuid.uuid4(),
            project_id=project.id,
            title=ep.title[:200],
            description=ep.description,
            source_quote="Delivers " + ", ".join(ids),
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
                    title=story.title[:200],
                    description=(
                        f"Delivers {', '.join(story.requirement_ids)} · {story.layer} · "
                        f"{story.estimate} point{'s' if story.estimate > 1 else ''}"
                    ),
                    acceptance_criteria=story.acceptance_criteria,
                    status="draft",
                )
            )
    await session.flush()
    return n - (start or 0)


async def run(project_id: uuid.UUID) -> None:
    """Background job: draft the PRD, ERD and backlog for a promoted project."""
    async with sessionmaker()() as session:
        project = await session.get(Project, project_id)
        if project is None:
            return
        idea = await session.get(Idea, project.idea_id) if project.idea_id else None
        product = await session.get(Product, project.product_id) if project.product_id else None
        lead = await session.get(User, project.lead_id or project.created_by)
        await _set_status(session, project, state="running", step="Reading the repository", error=None)
        try:
            snapshot = None
            if product and repo_context.repo_url(product):
                snapshot = await repo_context.latest(session, product.id) or await repo_context.take_snapshot(
                    session, product, project.created_by
                )
            code = repo_context.render(snapshot, 110_000) if snapshot else "REPOSITORY: none connected."
            context = _context(project, idea, product, code)

            await _set_status(session, project, step="Writing the PRD")
            prd = await _generate(Prd, PRD_SYSTEM, context, check_prd)

            await _set_status(session, project, step="Designing the data model and the backlog")
            with_prd = f"{context}\n\nAPPROVED-FOR-DRAFTING PRD:\n{prd.model_dump_json()}"
            erd, backlog = await asyncio.gather(
                _generate(Erd, ERD_SYSTEM, with_prd, lambda e: check_erd(e, snapshot)),
                _generate(Backlog, BACKLOG_SYSTEM, with_prd, lambda b: check_backlog(b, prd)),
            )

            model = llm.chat_model_name()
            for kind, title, doc in (("prd", f"PRD: {project.name}", prd), ("erd", f"ERD: {project.name}", erd)):
                version = (
                    await session.scalar(
                        select(func.coalesce(func.max(ProjectDocument.version), 0)).where(
                            ProjectDocument.project_id == project.id, ProjectDocument.kind == kind
                        )
                    )
                ) + 1
                session.add(
                    ProjectDocument(
                        project_id=project.id,
                        kind=kind,
                        version=version,
                        title=title,
                        content=doc.model_dump(mode="json"),
                        model=model,
                        created_by=project.created_by,
                    )
                )
            stories = await _store_backlog(session, project, backlog)
            if lead:
                await plan.sync_plan(session, project, lead)
            await process.advance(
                session,
                project,
                process.Event.EVALUATED,
                actor=ledger.Actor.ai("planner"),
                role=None,
                payload={
                    "documents": ["prd", "erd"],
                    "requirements": len(prd.functional),
                    "epics": len(backlog.epics),
                    "stories": stories,
                    "model": model,
                    "commit": snapshot.commit_sha if snapshot else None,
                },
            )
            await _set_status(
                session,
                project,
                state="ready",
                step="Plan drafted: review the PRD, ERD and backlog, then approve the plan",
                finishedAt=dt.datetime.now(dt.UTC).isoformat(),
            )
        except (ModelError, repo_context.RepoContextError, process.TransitionError) as exc:
            logger.warning("Project docs failed for %s: %s", project_id, exc)
            await session.rollback()
            project = await session.get(Project, project_id)
            assert project is not None
            await _set_status(session, project, state="failed", error=str(exc)[:1000])
