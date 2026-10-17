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

"""How big a product is, and which of its ideas add up to a project.

A single idea is a **feature**: once approved it becomes an epic in a project
that already exists. A **project** is a group of related features, big enough
for a PRD, its own teams and a launch. Three pieces keep that true:

1. **Product profile.** The AI sizes the product (small, medium, large) from its
   setup and, when there is one, its code. Small products usually have one
   project that features flow into; larger ones run several in parallel.
2. **Grouping.** The AI bundles related features into project ideas. Code checks
   every group (real ideas, no idea in two groups, enough features) so a lone
   tweak can never be promoted to a project.
3. **Feature into project.** An approved feature is drafted into an existing
   project as one epic with stories, waiting for the lead's approval.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import idea_flow, ledger
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

FEATURE = "feature"
PROJECT = "project"
# Ideas that can still be grouped: not rejected, not already delivered.
GROUPABLE = (idea_flow.IDEA_DRAFT, idea_flow.IDEA_PENDING, idea_flow.IDEA_APPROVED)
MIN_GROUP = 2

# ── Product profile ───────────────────────────────────────────────────────────


class ProductProfile(BaseModel):
    """The AI's sizing of a product."""

    size: Literal["small", "medium", "large"]
    summary: str = Field(
        description="Two sentences: what the product is and its shape."
    )
    areas: list[str] = Field(
        max_length=10, description="Major modules or areas, short names."
    )
    reason: str = Field(description="One sentence: why this size.")


PROFILE_SYSTEM = """\
You size a software product so the factory knows what counts as a project in it.
- small: one app or service, a handful of screens or endpoints, one team. It is
  built as one project; new ideas are features added to that project.
- medium: several modules or user groups, a few teams, a few projects in parallel.
- large: a platform of many services or sub-products and many teams.
Judge from the inputs only. Never invent users, numbers or modules.
Plain sentences, no Markdown.
"""


def _heuristic_profile(settings: dict[str, Any], file_count: int) -> dict[str, Any]:
    features = len(settings.get("keyFeatures") or [])
    if file_count > 1500 or features >= 12:
        size = "large"
    elif file_count > 300 or features >= 6:
        size = "medium"
    else:
        size = "small"
    return {
        "size": size,
        "summary": "",
        "areas": [],
        "reason": f"Estimated from {features} key features and {file_count} files.",
    }


async def analyse_product(
    *,
    name: str,
    description: str,
    settings: dict[str, Any],
    snapshot: RepoSnapshot | None = None,
) -> dict[str, Any]:
    """Sizes a product; falls back to a rule of thumb when no model answers."""
    code = (
        repo_context.render(snapshot, 30_000)
        if snapshot
        else "REPOSITORY: not scanned yet."
    )
    prompt = (
        f"PRODUCT: {name}\n{description}\n"
        f"Problem: {settings.get('problemStatement') or 'n/a'}\n"
        f"Target users: {settings.get('targetUsers') or 'n/a'}\n"
        f"Tech stack: {', '.join(settings.get('techStack') or []) or 'n/a'}\n"
        f"Key features: {'; '.join(settings.get('keyFeatures') or []) or 'n/a'}\n"
        f"Constraints: {'; '.join(settings.get('constraints') or []) or 'n/a'}\n\n{code}"
    )
    now = dt.datetime.now(dt.UTC).isoformat()
    try:
        out = await llm.generate_structured(
            prompt=prompt, schema=ProductProfile, system=PROFILE_SYSTEM, timeout_s=180
        )
        return {**out.model_dump(), "source": "ai", "analysedAt": now}
    except Exception as exc:  # any model or provider failure falls back
        logger.info("Product profile fell back to a heuristic for %s: %s", name, exc)
        files = snapshot.file_count if snapshot else 0
        return {
            **_heuristic_profile(settings, files),
            "source": "heuristic",
            "analysedAt": now,
        }


def profile_of(product: Product | None) -> dict[str, Any] | None:
    """The stored profile, if the product was sized."""
    if product is None:
        return None
    prof = (product.settings or {}).get("profile")
    return prof if isinstance(prof, dict) else None


async def refresh_profile(session: AsyncSession, product: Product) -> dict[str, Any]:
    """Re-sizes the product with its latest code snapshot and stores the result."""
    snapshot = await repo_context.latest(session, product.id)
    prof = await analyse_product(
        name=product.name,
        description=product.description,
        settings=product.settings or {},
        snapshot=snapshot,
    )
    product.settings = {**(product.settings or {}), "profile": prof}
    await session.flush()
    return prof


async def profile_in_background(product_id: uuid.UUID) -> None:
    """Background job run after a product is created without a profile."""
    async with sessionmaker()() as session:
        product = await session.get(Product, product_id)
        if product is None:
            return
        await refresh_profile(session, product)
        await session.commit()
        if product.workspace_id:
            await notify_workspace(product.workspace_id, "products")


# ── Grouping ──────────────────────────────────────────────────────────────────


class ProposedGroup(BaseModel):
    """Related features that together make one project."""

    title: str = Field(description="The project's name, under 80 characters.")
    problem_statement: str = Field(
        description="The shared goal these features deliver."
    )
    expected_value: str = Field(description="Who gains what. No invented numbers.")
    feature_numbers: list[int] = Field(
        min_length=MIN_GROUP, description="Numbers from the FEATURES list."
    )
    rationale: str = Field(description="One sentence: why these belong together.")


class GroupPlan(BaseModel):
    """Projects proposed from the product's features."""

    groups: list[ProposedGroup] = Field(max_length=8)


GROUP_SYSTEM = """\
You organise a product backlog into projects.
A project is a substantial body of work: several related features that share one
goal, user journey or module, worth its own PRD and teams. A single feature is
never a project on its own.
Rules:
- Group only features that truly belong together. Do not force unrelated
  features into a group to make one; leftover features simply stay features.
- Every group has at least two features. A feature is in at most one group.
- Use the numbers from the FEATURES list exactly.
- Small products are built as one project: propose at most one group for them.
- Never invent features, users or numbers. Plain sentences, no Markdown.
"""


class GroupingError(ValueError):
    """The grouping cannot run (too few features, or the product needs none)."""


def check_groups(plan_: GroupPlan, count: int) -> list[str]:
    """Numbers are real, unique across groups, and every group is big enough."""
    problems: list[str] = []
    seen: set[int] = set()
    for g in plan_.groups:
        nums = list(dict.fromkeys(g.feature_numbers))
        bad = [n for n in nums if not 1 <= n <= count]
        if bad:
            problems.append(f"Group '{g.title[:50]}' uses unknown numbers: {bad}.")
        dup = [n for n in nums if n in seen]
        if dup:
            problems.append(f"Features {dup} appear in more than one group.")
        if len(nums) < MIN_GROUP:
            problems.append(
                f"Group '{g.title[:50]}' has fewer than {MIN_GROUP} features."
            )
        seen.update(nums)
    return problems


async def _candidates(session: AsyncSession, product: Product) -> list[Idea]:
    return list(
        (
            await session.scalars(
                select(Idea)
                .where(
                    Idea.product_id == product.id,
                    Idea.scope == FEATURE,
                    Idea.parent_id.is_(None),
                    Idea.project_id.is_(None),
                    Idea.status.in_(GROUPABLE),
                )
                .order_by(Idea.created_at)
            )
        ).all()
    )


async def _live_projects(session: AsyncSession, product: Product) -> list[Project]:
    return list(
        (
            await session.scalars(
                select(Project).where(
                    Project.product_id == product.id, Project.archived_at.is_(None)
                )
            )
        ).all()
    )


def make_group(
    product: Product,
    children: list[Idea],
    *,
    title: str,
    problem: str,
    value: str,
    rationale: str,
    author_id: uuid.UUID | None,
    source: str,
) -> Idea:
    """A project idea over ``children``. Approved already if every feature was.

    The caller adds and flushes it, then calls :func:`attach` (the group row must
    exist before the features point at it).
    """
    approved = all(c.status == idea_flow.IDEA_APPROVED for c in children)
    tags: list[str] = []
    for c in children:
        for t in c.tags or []:
            if t not in tags:
                tags.append(t)
    evidence: list[str] = []
    for c in children:
        for e in c.evidence or []:
            if e not in evidence:
                evidence.append(e)
    group = Idea(
        id=uuid.uuid4(),
        product_id=product.id,
        workspace_id=product.workspace_id,
        title=title.strip()[:120],
        problem_statement=problem.strip(),
        expected_value=value.strip(),
        target_user=children[0].target_user,
        author_id=author_id,
        status=idea_flow.IDEA_APPROVED if approved else idea_flow.IDEA_DRAFT,
        complexity="High",
        tags=tags[:6],
        evidence=evidence[:20],
        scope=PROJECT,
        source=source,
        assessment={"rationale": rationale, "featureCount": len(children)},
    )
    return group


def attach(group: Idea, children: list[Idea]) -> None:
    """Points the features at their (already flushed) project idea."""
    for c in children:
        c.parent_id = group.id


async def group_ideas(
    session: AsyncSession, product: Product, author_id: uuid.UUID | None
) -> list[Idea]:
    """Asks the AI to bundle related features into projects; returns the new groups.

    Raises:
        GroupingError: Fewer than two ungrouped features, or a small product that
            already has its project (features are added to it instead).
        ModelError: The model's grouping failed its checks twice.
    """
    ideas = await _candidates(session, product)
    if len(ideas) < MIN_GROUP:
        raise GroupingError("There are fewer than two ungrouped features to group.")
    prof = profile_of(product) or {}
    projects = await _live_projects(session, product)
    if prof.get("size") == "small" and projects:
        raise GroupingError(
            f"{product.name} is a small product and already has its project "
            f"({projects[0].name}). Add approved features to it instead of starting a new one."
        )
    listing = "\n".join(
        f"{n}. [{i.status}] {i.title}: {i.problem_statement[:400]} "
        f"(tags: {', '.join(i.tags or [])}; evidence: {', '.join(map(str, (i.evidence or [])[:5]))})"
        for n, i in enumerate(ideas, 1)
    )
    prompt = (
        f"PRODUCT: {product.name}\n{product.description}\n"
        f"Size: {prof.get('size', 'unknown')}. {prof.get('summary', '')}\n"
        f"Areas: {', '.join(prof.get('areas') or []) or 'unknown'}\n"
        f"Projects already running: {', '.join(p.name for p in projects) or 'none'}\n\n"
        f"FEATURES:\n{listing}"
    )
    out = await llm.generate_structured(
        prompt=prompt, schema=GroupPlan, system=GROUP_SYSTEM, timeout_s=300
    )
    problems = check_groups(out, len(ideas))
    if problems:
        out = await llm.generate_structured(
            prompt=f"{prompt}\n\nYOUR PREVIOUS ANSWER WAS REJECTED:\n- "
            + "\n- ".join(problems)
            + f"\n\nPrevious answer:\n{out.model_dump_json()}\n\nReturn the corrected answer.",
            schema=GroupPlan,
            system=GROUP_SYSTEM,
            temperature=0.1,
            timeout_s=300,
        )
        problems = check_groups(out, len(ideas))
        if problems:
            raise ModelError("Grouping failed its checks twice: " + "; ".join(problems))
    groups = out.groups[:1] if prof.get("size") == "small" else out.groups
    created: list[tuple[Idea, list[Idea]]] = []
    for g in groups:
        children = [ideas[n - 1] for n in dict.fromkeys(g.feature_numbers)]
        group = make_group(
            product,
            children,
            title=g.title,
            problem=g.problem_statement,
            value=g.expected_value,
            rationale=g.rationale,
            author_id=author_id,
            source="agent",
        )
        session.add(group)
        created.append((group, children))
    await session.flush()
    for g, children in created:
        attach(g, children)
        await ledger.append(
            session,
            actor=ledger.Actor.ai("planner"),
            action="idea.grouped",
            subject_type="idea",
            subject_id=g.id,
            payload={"title": g.title, "features": len(children)},
        )
    await session.flush()
    return [g for g, _ in created]


async def children_of(session: AsyncSession, idea_id: uuid.UUID) -> list[Idea]:
    """The features a project idea groups."""
    return list(
        (
            await session.scalars(
                select(Idea).where(Idea.parent_id == idea_id).order_by(Idea.created_at)
            )
        ).all()
    )


# ── Feature into an existing project ─────────────────────────────────────────


class FeatureStory(BaseModel):
    """A user story for the feature."""

    title: str = Field(description="As a <user>, I want <goal> so that <benefit>.")
    acceptance_criteria: list[str] = Field(
        min_length=2, max_length=6, description="Given/When/Then."
    )
    estimate: Literal[1, 2, 3, 5, 8]
    layer: Literal["backend", "frontend", "data", "test", "docs", "devops"]


class FeatureEpic(BaseModel):
    """One approved feature, as an epic of the project it joins."""

    title: str
    description: str
    stories: list[FeatureStory] = Field(min_length=1, max_length=8)


FEATURE_SYSTEM = """\
You are the tech lead of an existing project. Turn one approved feature into a
single epic with user stories that one developer can each finish in a few days.
Build on the project's PRD and code; do not repeat work the project already plans.
Include test work inside stories. Never invent customers or numbers.
Plain sentences, no Markdown.
"""


async def _set_delivery(session: AsyncSession, idea: Idea, **values: Any) -> None:
    idea.delivery = {**(idea.delivery or {}), **values}
    await session.commit()
    if idea.workspace_id:
        await notify_workspace(idea.workspace_id, "ideas")


async def deliver_feature(
    idea_id: uuid.UUID, project_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    """Background job: draft the feature into the project as an epic with draft stories."""
    async with sessionmaker()() as session:
        idea = await session.get(Idea, idea_id)
        project = await session.get(Project, project_id)
        user = await session.get(User, user_id)
        if idea is None or project is None or user is None:
            return
        try:
            prd = await session.scalar(
                select(ProjectDocument)
                .where(
                    ProjectDocument.project_id == project.id,
                    ProjectDocument.kind == "prd",
                )
                .order_by(ProjectDocument.version.desc())
                .limit(1)
            )
            product = (
                await session.get(Product, project.product_id)
                if project.product_id
                else None
            )
            snapshot = (
                await repo_context.latest(session, product.id) if product else None
            )
            report = (idea.review_report or {}).get("report")
            prompt = (
                f"PROJECT: {project.name}\n{project.idea_text}\n\n"
                f"PROJECT PRD:\n{json.dumps(prd.content)[:20000] if prd else '(none yet)'}\n\n"
                f"FEATURE: {idea.title}\nProblem: {idea.problem_statement}\n"
                f"Expected value: {idea.expected_value}\nTarget user: {idea.target_user}\n"
                f"Evaluation: {json.dumps(report)[:8000] if report else '(none)'}\n\n"
                + (
                    repo_context.render(snapshot, 60_000)
                    if snapshot
                    else "REPOSITORY: none."
                )
            )
            epic_out = await llm.generate_structured(
                prompt=prompt, schema=FeatureEpic, system=FEATURE_SYSTEM, timeout_s=600
            )
            start = (
                await session.scalar(
                    select(func.count())
                    .select_from(Task)
                    .where(Task.project_id == project.id)
                )
                or 0
            )
            position = (
                await session.scalar(
                    select(func.count())
                    .select_from(Epic)
                    .where(Epic.project_id == project.id)
                )
                or 0
            )
            epic = Epic(
                id=uuid.uuid4(),
                project_id=project.id,
                title=epic_out.title[:200],
                description=epic_out.description,
                source_quote=f"Feature: {idea.title}"[:500],
                position=position,
            )
            session.add(epic)
            for n, story in enumerate(epic_out.stories, start + 1):
                session.add(
                    Task(
                        project_id=project.id,
                        epic_id=epic.id,
                        key=f"KAR-{n}",
                        title=story.title[:200],
                        description=(
                            f"Feature {idea.title[:60]} · {story.layer} · "
                            f"{story.estimate} point{'s' if story.estimate > 1 else ''}"
                        ),
                        acceptance_criteria=story.acceptance_criteria,
                        status="draft",
                    )
                )
            await session.flush()
            await plan.sync_plan(session, project, user)
            idea.status = idea_flow.IDEA_PROMOTED
            idea.project_id = project.id
            await ledger.append(
                session,
                actor=ledger.Actor.ai("planner"),
                action="idea.added_to_project",
                subject_type="project",
                subject_id=project.id,
                project_id=project.id,
                payload={"idea_id": str(idea.id), "stories": len(epic_out.stories)},
            )
            await _set_delivery(
                session,
                idea,
                state="ready",
                stories=len(epic_out.stories),
                finishedAt=dt.datetime.now(dt.UTC).isoformat(),
            )
            if project.workspace_id:
                await notify_workspace(project.workspace_id, "projects")
        except Exception as exc:  # the job reports every failure on the idea
            logger.warning(
                "Feature %s into project %s failed: %s", idea_id, project_id, exc
            )
            await session.rollback()
            idea = await session.get(Idea, idea_id)
            if idea is not None:
                await _set_delivery(session, idea, state="failed", error=str(exc)[:500])
