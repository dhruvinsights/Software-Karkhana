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

"""Project memory: capture learnings on merge, reuse only verified ones (B1-B3).

Retrieval is pgvector cosine search over learnings with ``status='verified'``.
Unverified agent claims are never offered to the evaluator.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import ledger
from app.ai import llm
from app.ai.errors import ModelError
from app.ai.evaluator import MemoryItem
from app.models import Learning, Project, PullRequest, ReviewComment, Task
from app.schemas import LearningOutput

logger = logging.getLogger(__name__)

MIN_SIMILARITY = 0.55
TOP_K = 3


async def retrieve(
    session: AsyncSession,
    idea_text: str,
    *,
    project_id: uuid.UUID,
    workspace_id: uuid.UUID | None,
) -> list[tuple[Learning, str, float]]:
    """Returns verified learnings similar to the idea as (learning, project name, similarity)."""
    try:
        query_vec = await llm.embed(idea_text, task_type="RETRIEVAL_QUERY")
    except ModelError as exc:
        logger.warning("Memory retrieval skipped: %s", exc)
        return []
    distance = Learning.embedding.cosine_distance(query_vec)
    rows = await session.execute(
        select(Learning, Project.name, distance.label("d"))
        .join(Project, Project.id == Learning.project_id)
        .where(
            Learning.status == "verified",
            Learning.embedding.is_not(None),
            # Vectors from different models are not comparable.
            Learning.embedding_model == llm.embed_model_name(),
            # Tenant boundary: learnings from the same workspace only. Legacy
            # projects without a workspace share the single-tenant pool.
            (
                Project.workspace_id.is_(None)
                if workspace_id is None
                else Project.workspace_id == workspace_id
            ),
        )
        .order_by(distance)
        .limit(TOP_K)
    )
    hits = [(lr, name, 1.0 - float(d)) for lr, name, d in rows.all()]
    return [h for h in hits if h[2] >= MIN_SIMILARITY]


def as_memory_items(hits: list[tuple[Learning, str, float]]) -> list[MemoryItem]:
    """Converts retrieval hits to evaluator input."""
    return [
        MemoryItem(id=str(lr.id), text=lr.text, project=name) for lr, name, _ in hits
    ]


LEARNING_SYSTEM = """\
You distill one reusable engineering lesson from a merged pull request and the
developer's triage of AI review comments. Prefer lessons confirmed by comments
marked valid. Never present a dismissed comment as a lesson. One or two
sentences, concrete, no names of people.
"""


async def capture_on_merge(
    session: AsyncSession, *, pr: PullRequest, task: Task, actor: ledger.Actor
) -> Learning:
    """Saves an unverified learning linked to the PR and its triaged comments."""
    comments = (
        await session.scalars(select(ReviewComment).where(ReviewComment.pr_id == pr.id))
    ).all()
    triage = "\n".join(
        f"- [{c.triage}] ({c.severity}) {c.path}: {c.body}"
        + (
            f" | dismissed because: {c.triage_reason}"
            if c.triage == "dismissed"
            else ""
        )
        for c in comments
    )
    prompt = f"Story: {task.title}\nPR: {pr.url}\nReview triage:\n{triage}"
    try:
        out = await llm.generate_structured(
            prompt=prompt,
            schema=LearningOutput,
            system=LEARNING_SYSTEM,
            temperature=0.2,
        )
        text = out.text
    except ModelError as exc:
        logger.warning("Learning distillation failed, storing raw triage: %s", exc)
        valid = [c.body for c in comments if c.triage == "valid"]
        text = (
            valid[0]
            if valid
            else f"Merged '{task.title}' with no confirmed review findings."
        )

    try:
        vec = await llm.embed(text)
    except ModelError:
        vec = None  # Still saved; it simply cannot be retrieved until re-embedded.

    learning = Learning(
        id=uuid.uuid4(),
        project_id=task.project_id,
        pr_id=pr.id,
        text=text,
        status="unverified",
        embedding=vec,
        embedding_model=llm.embed_model_name() if vec is not None else None,
        source={
            "pr_url": pr.url,
            "pr_number": pr.number,
            "task_key": task.key,
            "comment_ids": [str(c.id) for c in comments],
            "valid_comment_ids": [str(c.id) for c in comments if c.triage == "valid"],
        },
    )
    session.add(learning)
    await session.flush()
    await ledger.append(
        session,
        actor=actor,
        action="learning.captured",
        subject_type="learning",
        subject_id=learning.id,
        project_id=task.project_id,
        payload={"status": "unverified", "pr": pr.number, "embedded": vec is not None},
    )
    return learning
