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

"""Design station: the spec a designer reviews and hands to developers.

From the approved PRD, the backlog and the code, the model drafts API
contracts and, when the change has a user interface, screen prototypes as
self-contained HTML. Code checks that every story key exists, that examples
are valid JSON, and that prototypes contain no scripts or external resources
(they are shown in a sandboxed frame). A designer approves it; approval posts
a handoff to the project's shared context, which the developer's agent reads.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.ai import llm
from app.ai.errors import ModelError
from app.db import sessionmaker
from app.models import Product, Project, ProjectDocument, Task
from app.services import greenfield, repo_context
from app.services.realtime import notify_workspace

logger = logging.getLogger(__name__)


class ApiContract(BaseModel):
    """One endpoint a story needs."""

    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"]
    path: str = Field(pattern=r"^/")
    summary: str
    story_keys: list[str] = Field(min_length=1)
    request_example: str = Field(description="JSON body, or empty for none.")
    response_example: str = Field(description="JSON body of the success response.")
    errors: list[str] = Field(description="'404: group not found' style lines.")


class Screen(BaseModel):
    """A screen prototype."""

    name: str
    purpose: str
    story_keys: list[str] = Field(min_length=1)
    states: list[str] = Field(description="Empty, loading, error and success states shown.")
    html: str = Field(description="Self-contained HTML with an inline <style>; no scripts, no external URLs.")


class Token(BaseModel):
    """A design token."""

    name: str
    value: str


class DesignSpec(BaseModel):
    """The design handed to developers."""

    overview: str
    principles: list[str] = Field(min_length=1, max_length=6)
    api_contracts: list[ApiContract] = Field(max_length=12)
    screens: list[Screen] = Field(max_length=4)
    tokens: list[Token] = Field(max_length=16)
    accessibility: list[str]
    handoff_notes: list[str] = Field(min_length=1, description="What the developer must know first.")


SYSTEM = """\
You are a senior product designer working with an API-first team. Design the
change described by the approved PRD and stories.

Rules:
- Cite the story keys (KAR-n) each contract or screen serves.
- Follow the conventions you see in the existing code (paths, naming, units
  such as integer paise, error style). Do not redesign what already exists.
- Add screens only if the PRD describes a user interface; otherwise return no
  screens and put the effort into precise API contracts.
- Prototype HTML must be self-contained: one inline <style>, no <script>, no
  external fonts, images or links.
- No Markdown syntax in field values.
"""

_EXTERNAL = re.compile(r"""(?:src|href)\s*=\s*["']?\s*(?:https?:)?//""", re.I)


def check(spec: DesignSpec, story_keys: set[str]) -> list[str]:
    """Problems a developer should never inherit."""
    problems: list[str] = []
    for c in spec.api_contracts:
        unknown = [k for k in c.story_keys if k not in story_keys]
        if unknown:
            problems.append(f"{c.method} {c.path} cites unknown stories: {', '.join(unknown)}.")
        for label, body in (("request", c.request_example), ("response", c.response_example)):
            if body.strip():
                try:
                    json.loads(body)
                except json.JSONDecodeError:
                    problems.append(f"{c.method} {c.path}: the {label} example is not valid JSON.")
    for s in spec.screens:
        unknown = [k for k in s.story_keys if k not in story_keys]
        if unknown:
            problems.append(f"Screen '{s.name}' cites unknown stories: {', '.join(unknown)}.")
        if re.search(r"<\s*script", s.html, re.I) or _EXTERNAL.search(s.html):
            problems.append(f"Screen '{s.name}' uses a script or an external resource.")
    return problems


async def _draft(prompt: str, keys: set[str]) -> DesignSpec:
    spec = await llm.generate_structured(prompt=prompt, schema=DesignSpec, system=SYSTEM, timeout_s=600)
    problems = check(spec, keys)
    if not problems:
        return spec
    spec = await llm.generate_structured(
        prompt=f"{prompt}\n\nYOUR PREVIOUS DESIGN WAS REJECTED:\n- "
        + "\n- ".join(problems)
        + f"\n\nPrevious design:\n{spec.model_dump_json()}\n\nReturn the corrected design.",
        schema=DesignSpec,
        system=SYSTEM,
        temperature=0.1,
        timeout_s=600,
    )
    problems = check(spec, keys)
    if problems:
        raise ModelError("The design failed its checks twice: " + "; ".join(problems))
    return spec


async def run(project_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Background job: draft the design spec as the next ``design`` document version."""
    async with sessionmaker()() as session:
        project = await session.get(Project, project_id)
        if project is None:
            return

        async def status(**fields: object) -> None:
            project.docs_status = {**(project.docs_status or {}), "design": fields}
            await session.commit()
            if project.workspace_id:
                await notify_workspace(project.workspace_id, "projects")

        await status(state="running")
        try:
            prd = await session.scalar(
                select(ProjectDocument)
                .where(ProjectDocument.project_id == project.id, ProjectDocument.kind == "prd")
                .order_by(ProjectDocument.version.desc())
                .limit(1)
            )
            if prd is None or prd.status != "approved":
                raise ModelError("Approve the plan (PRD and backlog) before designing.")
            tasks = (await session.scalars(select(Task).where(Task.project_id == project.id))).all()
            stories = [
                {"key": t.key, "title": t.title, "notes": t.description, "acceptance": t.acceptance_criteria}
                for t in tasks
            ]
            product = await session.get(Product, project.product_id) if project.product_id else None
            snapshot = await repo_context.latest(session, product.id) if product else None
            code = greenfield.context_for(snapshot, 90_000)
            prompt = (
                f"PROJECT: {project.name}\n\nAPPROVED PRD:\n{json.dumps(prd.content)}\n\n"
                f"STORIES:\n{json.dumps(stories)}\n\n{code}"
            )
            spec = await _draft(prompt, {t.key for t in tasks})
            version = (
                await session.scalar(
                    select(func.coalesce(func.max(ProjectDocument.version), 0)).where(
                        ProjectDocument.project_id == project.id, ProjectDocument.kind == "design"
                    )
                )
            ) + 1
            session.add(
                ProjectDocument(
                    project_id=project.id,
                    kind="design",
                    version=version,
                    title=f"Design: {project.name}",
                    content=spec.model_dump(mode="json"),
                    model=llm.chat_model_name(),
                    created_by=user_id,
                )
            )
            await status(state="ready", version=version)
        except (ModelError, repo_context.RepoContextError) as exc:
            logger.warning("Design draft failed for %s: %s", project_id, exc)
            await session.rollback()
            project = await session.get(Project, project_id)
            assert project is not None
            await status(state="failed", error=str(exc)[:1000])
