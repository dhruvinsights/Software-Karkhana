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

"""Idea evaluation report: is this idea worth building, and can we build it?

The model fills a typed schema (``IdeaReport``); code does the rest:

* every ``modify`` path it cites must exist in the product's repository
  snapshot, and a ``new`` path must sit in a directory that exists;
* the overall score is computed here from the dimension scores with a fixed,
  published weighting, so the headline number is never a model's guess;
* a failed check gets one repair pass, then the report fails visibly.

The stored value on ``ideas.review_report`` is
``{"status": "running" | "ready" | "failed", "report": ..., "meta": ..., "error": ...}``.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.ai import llm
from app.ai.errors import ModelError
from app.config import get_settings
from app.db import sessionmaker
from app.models import Idea, Product, RepoSnapshot
from app.services import greenfield, repo_context
from app.services.realtime import notify_workspace

logger = logging.getLogger(__name__)

Level = Literal["Low", "Medium", "High"]

# Weighting of the overall score. Effort and risk count against the idea.
WEIGHTS = {"user_value": 0.30, "strategic_fit": 0.20, "feasibility": 0.25, "effort": 0.10, "risk": 0.15}
_INVERTED = frozenset({"effort", "risk"})


class Score(BaseModel):
    """One dimension scored 1 (worst) to 10 (best), except effort and risk where 10 is most."""

    score: int = Field(ge=1, le=10)
    rationale: str = Field(description="One or two sentences grounded in the inputs.")


class Scores(BaseModel):
    """Five dimensions. For effort and risk, a higher score means more effort or risk."""

    user_value: Score
    strategic_fit: Score
    feasibility: Score
    effort: Score
    risk: Score


class AffectedArea(BaseModel):
    """Where in the codebase the idea lands."""

    path: str = Field(description="A repository path from the snapshot, file or directory.")
    kind: Literal["modify", "new"]
    change: str = Field(description="What changes there, in one sentence.")


class Risk(BaseModel):
    """A risk with its mitigation."""

    title: str
    likelihood: Level
    impact: Level
    mitigation: str


class Phase(BaseModel):
    """One delivery phase."""

    name: str
    weeks: float = Field(gt=0, le=26)
    deliverables: list[str] = Field(min_length=1)


class Alternative(BaseModel):
    """An option that was considered instead."""

    option: str
    tradeoff: str


class IdeaReport(BaseModel):
    """The evaluation the reviewers read before approving an idea."""

    verdict: Literal["Go", "Go with conditions", "Needs more evidence", "No-go"]
    executive_summary: str = Field(description="Three to five sentences: what, why, verdict.")
    problem: str
    target_users: list[str] = Field(min_length=1)
    value_hypothesis: str = Field(description="If we build X, users can Y, measured by Z.")
    success_metrics: list[str] = Field(min_length=1, max_length=6)
    scores: Scores
    current_state: str = Field(description="What the codebase does today in this area, citing paths.")
    proposed_approach: str
    affected_areas: list[AffectedArea] = Field(max_length=15)
    architecture_impact: str
    data_model_changes: list[str]
    new_dependencies: list[str]
    alternatives: list[Alternative] = Field(max_length=4)
    risks: list[Risk] = Field(min_length=2, max_length=6)
    size: Literal["S", "M", "L", "XL"]
    team: list[str] = Field(min_length=1, description="Roles needed, e.g. '1 backend developer'.")
    phases: list[Phase] = Field(min_length=1, max_length=6)
    assumptions: list[str] = Field(description="Claims not verifiable from the inputs (market, usage).")
    open_questions: list[str]
    conditions: list[str] = Field(description="What must be true for approval; empty for Go or No-go.")
    next_steps: list[str] = Field(min_length=1, max_length=6)


SYSTEM = """\
You are a principal engineer and a product lead writing an evaluation of one
product idea for the reviewers who will approve or reject it.

Rules:
- Ground every technical statement in the REPOSITORY section. When you name a
  file or directory, copy its path exactly from the tree. Use kind "modify" for
  paths that exist and "new" for files to create inside existing directories.
- Never invent customers, revenue, dates or usage numbers. Anything you believe
  but cannot verify from the inputs goes under "assumptions".
- Scores are 1 to 10. For effort and risk, a higher score means MORE effort or
  risk. Justify each score in one or two concrete sentences.
- Verdict: "Go" only if value is clear and the code supports it; "Go with
  conditions" lists the conditions; "Needs more evidence" names what is missing.
- Write plain prose for a busy director: short sentences, no marketing words,
  no Markdown syntax in field values.
"""


def overall_score(scores: Scores) -> float:
    """Weighted 0-10 score; effort and risk are inverted (11 - score)."""
    total = 0.0
    for name, weight in WEIGHTS.items():
        value = getattr(scores, name).score
        total += weight * ((11 - value) if name in _INVERTED else value)
    return round(total, 1)


def check_report(report: IdeaReport, snapshot: RepoSnapshot | None) -> list[str]:
    """Problems a reviewer should never see. Empty means the report is grounded."""
    if snapshot is None:
        return []
    problems: list[str] = []
    if not report.affected_areas:
        problems.append("affected_areas is empty; name the files or directories this idea changes.")
    for area in report.affected_areas:
        if area.kind == "modify" and not repo_context.known_path(snapshot, area.path):
            problems.append(f"'{area.path}' (modify) is not in the repository tree.")
        if area.kind == "new":
            parent = area.path.strip().strip("/").rsplit("/", 1)[0] if "/" in area.path else ""
            if parent and not repo_context.known_path(snapshot, parent):
                problems.append(f"'{area.path}' (new) is in a directory that does not exist: '{parent}'.")
    return problems


def _prompt(idea: Idea, product: Product | None, code: str) -> str:
    product_part = (
        f"PRODUCT: {product.name}\n{product.description or ''}\n"
        f"Setup: {json.dumps(product.settings or {}, default=str)[:3000]}"
        if product
        else "PRODUCT: (none)"
    )
    return (
        f"{product_part}\n\n"
        f"IDEA: {idea.title}\n"
        f"Problem: {idea.problem_statement}\n"
        f"Target users: {idea.target_user}\n"
        f"Expected value: {idea.expected_value}\n"
        f"Evidence cited when the idea was raised: {json.dumps(idea.evidence or [])}\n\n"
        f"{code}"
    )


async def generate(
    idea: Idea, product: Product | None, snapshot: RepoSnapshot | None
) -> IdeaReport:
    """Writes and validates the report. Raises ``ModelError`` if it stays ungrounded."""
    code = (
        greenfield.context_for(snapshot, get_settings().repo_context_budget_chars)
        if snapshot
        else "REPOSITORY: none connected. Say so in current_state and keep affected_areas empty."
    )
    prompt = _prompt(idea, product, code)
    report = await llm.generate_structured(
        prompt=prompt, schema=IdeaReport, system=SYSTEM, timeout_s=600
    )
    problems = check_report(report, snapshot)
    if not problems:
        return report
    logger.info("Idea report repair pass: %s", problems)
    repair = (
        f"{prompt}\n\nYOUR PREVIOUS REPORT WAS REJECTED:\n- "
        + "\n- ".join(problems)
        + f"\n\nPrevious report:\n{report.model_dump_json()}\n\nReturn the corrected report."
    )
    report = await llm.generate_structured(
        prompt=repair, schema=IdeaReport, system=SYSTEM, temperature=0.1, timeout_s=600
    )
    problems = check_report(report, snapshot)
    if problems:
        raise ModelError("The report cites code that does not exist: " + "; ".join(problems))
    return report


async def run(idea_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Background job: snapshot the repo if needed, write the report, store it."""
    async with sessionmaker()() as session:
        idea = await session.get(Idea, idea_id)
        if idea is None:
            return
        product = await session.get(Product, idea.product_id) if idea.product_id else None
        stored: dict[str, Any]
        try:
            snapshot = None
            if product and repo_context.repo_url(product):
                snapshot = await greenfield.snapshot_for(session, product, user_id)
            report = await generate(idea, product, snapshot)
            stored = {
                "status": "ready",
                "report": report.model_dump(mode="json"),
                "meta": {
                    "overallScore": overall_score(report.scores),
                    "weights": WEIGHTS,
                    "model": llm.chat_model_name(),
                    "commit": snapshot.commit_sha if snapshot else None,
                    "repoUrl": snapshot.repo_url if snapshot else None,
                    "generatedAt": dt.datetime.now(dt.UTC).isoformat(),
                    "generatedBy": str(user_id),
                },
            }
        except (ModelError, repo_context.RepoContextError) as exc:
            logger.warning("Idea report failed for %s: %s", idea_id, exc)
            stored = {"status": "failed", "error": str(exc)[:1000]}
        idea.review_report = stored
        await session.commit()
        workspace_id = idea.workspace_id
    if workspace_id:
        await notify_workspace(workspace_id, "ideas")
