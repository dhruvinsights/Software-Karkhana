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

"""The developer steers a build: what the agent is given, and every decision on the way.

Endpoints (people):
  GET  /api/tasks/{id}/brief-preview   — everything the agent could be told, to pick from
  POST /api/runs/{id}/gate             — the developer's decision at a pause

Endpoints (the developer's machine, per-run token):
  POST /internal/runs/{id}/gate        — the build stops and asks, or clears the question
  GET  /internal/runs/{id}/gate        — the agent polls for the answer
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, ledger
from app.auth import CurrentUser
from app.db import get_session
from app.models import Project, Run, Task
from app.routers import runs
from app.services import run_context
from app.services.realtime import notify_workspace

router = APIRouter(tags=["run-control"])
Session = Annotated[AsyncSession, Depends(get_session)]

NOTE_PREVIEW = 700


@router.get("/api/tasks/{task_id}/brief-preview")
async def brief_preview(
    task_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """What the coding agent could be given for this story, so the developer can pick."""
    task = await session.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found.")
    project = await access.get_visible_project(session, user, task.project_id)
    await access.ensure_station(session, user, project, "developer")
    criteria = list(task.acceptance_criteria or [])
    notes = await run_context.gather_notes(session, project, task)
    last = await session.scalar(
        select(Run)
        .where(Run.task_id == task.id)
        .order_by(Run.created_at.desc())
        .limit(1)
    )
    rework = await runs._rework_for(session, last) if last is not None else None
    return {
        "story": {
            "key": task.key,
            "title": task.title,
            "description": task.description,
        },
        "criteria": [
            {"index": i, "text": c, "chars": len(c)} for i, c in enumerate(criteria)
        ],
        "notes": [
            {
                "id": n.id,
                "kind": n.kind,
                "title": n.title,
                "author": n.author,
                "body": n.body[:NOTE_PREVIEW],
                "chars": len(n.body),
            }
            for n in notes
        ],
        "rework": rework,
        "pauses": [
            {"id": p, "label": run_context.PAUSE_LABELS[p]} for p in run_context.PAUSES
        ],
        "estimateTokens": run_context.estimate_tokens(
            task.title, task.description, *criteria, *[n.body for n in notes]
        ),
    }


# ── The build asks, the developer answers ─────────────────────────────────────


class GateOption(BaseModel):
    """One thing the developer can answer."""

    id: str = Field(pattern=r"^[a-z_]{1,24}$")
    label: str = Field(max_length=80)
    needs_note: bool = False


class GateOpen(BaseModel):
    """The build stops here and waits (``clear`` withdraws the question)."""

    clear: bool = False
    name: str = Field(default="", max_length=40)
    summary: str = Field(default="", max_length=4000)
    options: list[GateOption] = Field(default_factory=list, max_length=6)


@router.post("/internal/runs/{run_id}/gate", include_in_schema=False)
async def open_gate(
    run_id: uuid.UUID,
    body: GateOpen,
    session: Session,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """The machine stops at a decision point; the developer sees it on the story."""
    run = await runs._run_for_worker(session, run_id, authorization)
    if run.status in runs.TERMINAL:
        return {"status": run.status}
    now = dt.datetime.now(dt.UTC)
    run.heartbeat_at = now
    if body.clear:
        run.gate = None
    else:
        options = [o.model_dump() for o in body.options] or [
            {"id": "go", "label": "Go on", "needs_note": False}
        ]
        run.gate = run_context.new_gate(
            body.name, body.summary, options, now.isoformat()
        )
    await runs._announce(session, run.project_id)
    return {"status": run.status}


@router.get("/internal/runs/{run_id}/gate", include_in_schema=False)
async def poll_gate(
    run_id: uuid.UUID,
    session: Session,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """The machine asks whether the developer has answered."""
    run = await runs._run_for_worker(session, run_id, authorization)
    if run.status not in runs.TERMINAL:
        run.heartbeat_at = dt.datetime.now(dt.UTC)
        await session.commit()
    return {"status": run.status, "gate": run.gate}


class Decision(BaseModel):
    """The developer's answer."""

    gate_id: str = Field(min_length=1, max_length=40)
    action: str = Field(pattern=r"^[a-z_]{1,24}$")
    note: str = Field(default="", max_length=2000)


@router.post("/api/runs/{run_id}/gate")
async def decide(
    run_id: uuid.UUID, body: Decision, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Answers the question the build is waiting on."""
    run = await session.scalar(select(Run).where(Run.id == run_id).with_for_update())
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found.")
    project: Project = await access.get_visible_project(session, user, run.project_id)
    await access.ensure_station(session, user, project, "developer")
    gate = run.gate
    if not gate or gate.get("decision") is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "The build is not waiting for a decision."
        )
    if gate.get("id") != body.gate_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "That question was already answered; refresh."
        )
    options = {o["id"]: o for o in gate.get("options", [])}
    if body.action != "stop" and body.action not in options:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Choose one of: {', '.join(options)}, stop.",
        )
    if options.get(body.action, {}).get("needs_note") and len(body.note.strip()) < 3:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Say what you want, so the agent can act on it.",
        )
    gate = {
        **gate,
        "decision": {
            "action": body.action,
            "note": body.note.strip(),
            "by": user.display_name,
            "at": dt.datetime.now(dt.UTC).isoformat(),
        },
    }
    run.gate = gate
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="run.decision",
        subject_type="run",
        subject_id=run.id,
        project_id=project.id,
        payload={
            "gate": gate["name"],
            "action": body.action,
            "note": body.note.strip()[:300],
        },
    )
    if body.action == "stop":
        await runs._finish_failed(
            session,
            run,
            "cancelled",
            f"Stopped by {user.display_name} at '{gate['name']}'.",
        )
    await session.commit()
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "runs")
    return {"status": run.status, "decision": gate["decision"]}
