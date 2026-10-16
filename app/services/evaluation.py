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


"""Idea evaluation: retrieve memory, evaluate, validate, store, record.

Runs as a background job after a project is created or re-evaluated.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, select

from app import ledger, memory, process
from app.ai import evaluator
from app.ai.errors import ModelError
from app.db import sessionmaker
from app.integrations import chat
from app.models import Epic, Evaluation, Project, Task
from app.process import Event

logger = logging.getLogger(__name__)


async def run_evaluation(project_id: uuid.UUID) -> None:
    """Background job: retrieve memory, evaluate, validate, store, record."""
    async with sessionmaker()() as session:
        project = await session.get(Project, project_id)
        if project is None:
            return
        try:
            hits = await memory.retrieve(
                session,
                project.idea_text,
                project_id=project.id,
                workspace_id=project.workspace_id,
            )
            result = await evaluator.evaluate(
                idea_text=project.idea_text,
                project_name=project.name,
                memory=memory.as_memory_items(hits),
            )
        except ModelError as exc:
            await ledger.append(
                session,
                actor=ledger.Actor.ai("evaluator"),
                action="evaluation.failed",
                subject_type="project",
                subject_id=project.id,
                project_id=project.id,
                payload={"error": str(exc)[:500]},
            )
            await session.commit()
            logger.error("Evaluation failed for %s: %s", project_id, exc)
            return

        version = (
            await session.scalar(
                select(func.coalesce(func.max(Evaluation.version), 0)).where(
                    Evaluation.project_id == project.id
                )
            )
        ) + 1
        out = result.output
        evaluation = Evaluation(
            project_id=project.id,
            version=version,
            payload=out.model_dump(mode="json"),
            model=result.model,
            memory_used=[
                {"learning_id": str(lr.id), "similarity": round(sim, 3)}
                for lr, _, sim in hits
            ],
        )
        session.add(evaluation)

        # Epics and stories are (re)drafted from the latest evaluation. They stay
        # Draft until the director approves.
        old_tasks = (
            await session.scalars(select(Task).where(Task.project_id == project.id))
        ).all()
        if any(t.status != "draft" for t in old_tasks):
            logger.info(
                "Project %s already has live tasks; keeping the board", project.id
            )
        else:
            for t in old_tasks:
                await session.delete(t)
            for e in (
                await session.scalars(select(Epic).where(Epic.project_id == project.id))
            ).all():
                await session.delete(e)
            await session.flush()
            n = 0
            for pos, ep in enumerate(out.epics):
                epic = Epic(
                    id=uuid.uuid4(),
                    project_id=project.id,
                    title=ep.title,
                    description=ep.description,
                    source_quote=ep.source_quote,
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
                            title=story.title,
                            description=ep.description,
                            acceptance_criteria=story.acceptance_criteria,
                            status="draft",
                        )
                    )
        await session.flush()
        await process.advance(
            session,
            project,
            Event.EVALUATED,
            actor=ledger.Actor.ai("evaluator"),
            role=None,
            payload={
                "evaluation_version": version,
                "score": out.score,
                "epics": len(out.epics),
                "schema_valid": True,
                "source_quotes_verified": True,
                "memory_citations": len(out.memory_citations),
                "model": result.model,
            },
        )
        await session.commit()
    await chat.notify(
        f"Karkhana: '{project.name}' was evaluated (score {out.score}/10). A director decision is needed."
    )
