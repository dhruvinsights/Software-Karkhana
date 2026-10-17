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

"""Idea scan: read a product's code, find gaps and opportunities.

1. Snapshot the repository (``app.services.repo_context``: clone + repomix).
2. Four specialist passes run in parallel over the same compressed code, each
   returning typed ideas (``SpecialistPassOutput``).
3. Code checks every idea: its evidence must name real paths in the snapshot,
   and near-duplicate titles across passes are merged.
4. Surviving ideas are stored as drafts; progress streams to the workspace.

A pass that fails is reported in the scan stats. If every pass fails, the scan
fails with the model errors. There are no template fallbacks.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import re
import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app import idea_flow
from app.ai import llm
from app.ai.errors import ModelError
from app.db import sessionmaker
from app.models import Idea, IdeaScan, Product, RepoSnapshot
from app.services import repo_context
from app.services.realtime import manager, notify_workspace

logger = logging.getLogger(__name__)


class DiscoveredIdea(BaseModel):
    """One idea a specialist found, with the files that support it."""

    title: str = Field(description="Action-oriented, under 80 characters.")
    problem_statement: str = Field(description="The gap, as seen in the code.")
    expected_value: str = Field(description="Who gains what. No invented numbers.")
    target_user: str
    category: Literal["Feature", "Architecture", "Security", "UX", "Quality"]
    complexity: Literal["Low", "Medium", "High"]
    value_score: Literal["High", "Medium", "Low"]
    effort: Literal["S", "M", "L", "XL"]
    risk: Literal["Low", "Medium", "High"]
    tags: list[str] = Field(max_length=5)
    evidence: list[str] = Field(
        min_length=1, description="Repository paths copied exactly from the tree."
    )


class SpecialistPassOutput(BaseModel):
    """What one specialist returns."""

    ideas: list[DiscoveredIdea] = Field(max_length=4)


PASSES: dict[str, str] = {
    "product": (
        "Product and feature gaps: user journeys the code starts but does not "
        "finish, endpoints or screens that are missing, obvious next features."
    ),
    "architecture": (
        "Architecture and technical debt: coupling, missing layers, scalability "
        "limits, data-model problems, missing tests around core logic."
    ),
    "reliability": (
        "Security and reliability: authentication and authorisation gaps, input "
        "validation, secrets handling, error handling, observability."
    ),
    "experience": (
        "Developer and user experience: setup friction, CI/CD, documentation, "
        "API ergonomics, accessibility."
    ),
}

SYSTEM = """\
You are a principal engineer and product strategist auditing one codebase.
Find concrete, buildable ideas in your assigned focus area only.

Rules:
- Every idea must be supported by what you see in the REPOSITORY section.
  Cite evidence as paths copied exactly from the tree.
- Prefer ideas a small team can ship in weeks over vague programmes.
- Never invent metrics, customers or market data.
- Return at most 4 ideas, best first. Return fewer rather than weak ones.
"""


def _key(title: str) -> str:
    """Normalised title used to merge near-duplicates across passes."""
    words = re.findall(r"[a-z0-9]+", title.casefold())
    return " ".join(w for w in words if w not in {"a", "an", "the", "and", "for", "to", "of"})


def verify(
    ideas: list[DiscoveredIdea], snapshot: RepoSnapshot
) -> tuple[list[DiscoveredIdea], int]:
    """Keeps ideas with at least one real evidence path; drops invented paths.

    Returns the surviving ideas (deduplicated by title) and how many were dropped.
    """
    kept: dict[str, DiscoveredIdea] = {}
    dropped = 0
    for idea in ideas:
        real = [p for p in idea.evidence if repo_context.known_path(snapshot, p)]
        key = _key(idea.title)
        if not real or key in kept:
            dropped += 1
            continue
        kept[key] = idea.model_copy(update={"evidence": real})
    return list(kept.values()), dropped


async def _pass(focus: str, brief: str, context: str, product: Product) -> list[DiscoveredIdea]:
    prompt = (
        f"PRODUCT: {product.name}\n{product.description or ''}\n\n"
        f"YOUR FOCUS ({focus}): {brief}\n\n{context}"
    )
    out = await llm.generate_structured(
        prompt=prompt, schema=SpecialistPassOutput, system=SYSTEM, timeout_s=600
    )
    return out.ideas


async def run_codebase_scan(
    scan_id: uuid.UUID,
    product_id: uuid.UUID,
    workspace_id: uuid.UUID,
    started_by_id: uuid.UUID | None,
) -> None:
    """Background job for one scan; the scan row records the outcome."""
    ws = str(workspace_id)

    async def progress(step: str, pct: int, note: str = "") -> None:
        await manager.broadcast(
            ws,
            {"type": "scan_progress", "scanId": str(scan_id), "step": step, "percent": pct, "note": note},
        )

    async with sessionmaker()() as session:
        scan = await session.get(IdeaScan, scan_id)
        product = await session.get(Product, product_id)
        assert scan is not None and product is not None
        try:
            await progress("Reading the repository", 10, scan.repo_url)
            snapshot = await repo_context.take_snapshot(session, product, started_by_id)
            await session.commit()
            await progress(
                "Specialists analysing the code",
                35,
                f"{snapshot.file_count} files at {snapshot.commit_sha[:8]}",
            )
            context = repo_context.render(snapshot)
            results = await asyncio.gather(
                *(_pass(focus, brief, context, product) for focus, brief in PASSES.items()),
                return_exceptions=True,
            )
            found: list[DiscoveredIdea] = []
            failed: dict[str, str] = {}
            for focus, result in zip(PASSES, results, strict=True):
                if isinstance(result, BaseException):
                    logger.warning("Scan pass %s failed: %s", focus, result)
                    failed[focus] = str(result)[:300]
                else:
                    found.extend(result)
            if len(failed) == len(PASSES):
                raise ModelError("Every specialist pass failed: " + "; ".join(failed.values()))

            await progress("Checking evidence against the code", 85)
            ideas, dropped = verify(found, snapshot)
            for item in ideas:
                session.add(
                    Idea(
                        id=uuid.uuid4(),
                        product_id=product.id,
                        workspace_id=workspace_id,
                        title=item.title.strip(),
                        problem_statement=item.problem_statement.strip(),
                        target_user=item.target_user.strip(),
                        expected_value=item.expected_value.strip(),
                        author_id=started_by_id,
                        status=idea_flow.IDEA_DRAFT,
                        complexity=item.complexity,
                        tags=item.tags or [item.category],
                        assessment={
                            "category": item.category,
                            "valueScore": item.value_score,
                            "effort": item.effort,
                            "risk": item.risk,
                        },
                        source="agent",
                        scan_id=scan_id,
                        evidence=item.evidence,
                    )
                )
            scan.status = "done"
            scan.model = llm.chat_model_name()
            scan.stats = {
                "totalIdeas": len(ideas),
                "droppedIdeas": dropped,
                "failedPasses": failed,
                "scannedFiles": snapshot.file_count,
                "commit": snapshot.commit_sha,
                "snapshotId": str(snapshot.id),
            }
            note = f"{len(ideas)} ideas, each tied to real files"
        except (ModelError, repo_context.RepoContextError) as exc:
            logger.warning("Idea scan %s failed: %s", scan_id, exc)
            scan.status = "failed"
            scan.error = str(exc)[:1000]
            note = f"Scan failed: {scan.error}"
        scan.finished_at = dt.datetime.now(dt.UTC)
        await session.commit()
    await progress("Completed" if scan.status == "done" else "Failed", 100, note)
    await notify_workspace(workspace_id, "ideas")
