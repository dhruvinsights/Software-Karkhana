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

"""Developer machines (``karkhana-agent``): pairing, the job queue and live logs.

People manage their machines under ``/api/devices`` with their normal session.
The agent itself calls ``/api/agent/*`` with ``Authorization: Device <token>``;
that token can claim jobs queued for this machine and post their logs, and
nothing else. Each claimed job carries a run token scoped to its one run,
which the agent uses for the same ``/internal/runs`` callbacks as any worker.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, db, ledger
from app.auth import CurrentUser
from app.config import get_settings
from app.models import AgentDevice, AgentJob, AgentJobLog, Project, Run, Task
from app.runner.base import run_token
from app.services import devices
from app.services.realtime import manager

router = APIRouter(tags=["agent_devices"])
Session = Annotated[AsyncSession, Depends(db.get_session)]

CLAIM_WAIT_S = 25.0
CLAIM_POLL_S = 1.5


def _device_out(d: AgentDevice) -> dict[str, Any]:
    return {
        "id": str(d.id),
        "name": d.name,
        "platform": d.platform,
        "harness": d.harness,
        "status": d.status,
        "online": devices.online(d),
        "lastSeenAt": d.last_seen_at.isoformat() if d.last_seen_at else None,
        "createdAt": d.created_at.isoformat(),
    }


# ── For people ────────────────────────────────────────────────────────────────


@router.post("/api/devices/pairing", status_code=status.HTTP_201_CREATED)
async def create_pairing(session: Session, user: CurrentUser) -> dict[str, Any]:
    """A one-time code to connect a machine. Valid for ten minutes."""
    device, code = await devices.start_pairing(session, user)
    server = get_settings().public_base_url.rstrip("/")
    return {
        "deviceId": str(device.id),
        "code": code,
        "expiresAt": device.pairing_expires_at.isoformat() if device.pairing_expires_at else None,
        "command": f"karkhana-agent login --server {server} --code {code}",
        "install": "npm install -g <software-karkhana checkout>/packages/karkhana-agent",
    }


@router.get("/api/devices")
async def list_devices(session: Session, user: CurrentUser) -> list[dict[str, Any]]:
    """My connected machines."""
    rows = (
        await session.scalars(
            select(AgentDevice)
            .where(AgentDevice.user_id == user.id, AgentDevice.status == "active")
            .order_by(AgentDevice.last_seen_at.desc().nulls_last())
        )
    ).all()
    return [_device_out(d) for d in rows]


@router.delete("/api/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_device(device_id: uuid.UUID, session: Session, user: CurrentUser) -> None:
    """Disconnects a machine; its token stops working immediately."""
    device = await session.get(AgentDevice, device_id)
    if device is None or device.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Machine not found.")
    device.status, device.token_hash = "revoked", None
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="device.revoked",
        subject_type="device",
        subject_id=device.id,
        payload={"name": device.name},
    )


# ── For the agent ─────────────────────────────────────────────────────────────


async def current_device(
    session: Session, authorization: Annotated[str | None, Header()] = None
) -> AgentDevice:
    """The machine behind ``Authorization: Device <token>``."""
    token = (authorization or "").removeprefix("Device ").strip()
    device = await devices.device_for_token(session, token) if token else None
    if device is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown or revoked machine. Run `karkhana-agent login` again.")
    return device


Device = Annotated[AgentDevice, Depends(current_device)]


class PairIn(BaseModel):
    """What the agent sends to finish pairing."""

    code: str = Field(min_length=9, max_length=9)
    name: str = Field(max_length=80)
    platform: str = Field(default="", max_length=80)
    harness: str = Field(default="bob", max_length=20)


@router.post("/api/agent/pair")
async def pair(body: PairIn, session: Session) -> dict[str, Any]:
    """Trades a pairing code for this machine's token (returned once)."""
    try:
        device, token = await devices.complete_pairing(
            session, code=body.code, name=body.name, platform=body.platform, harness=body.harness
        )
    except devices.PairingError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await ledger.append(
        session,
        actor=ledger.SYSTEM,
        action="device.paired",
        subject_type="device",
        subject_id=device.id,
        payload={"name": device.name, "platform": device.platform, "harness": device.harness, "user": str(device.user_id)},
    )
    return {"deviceId": str(device.id), "token": token, "name": device.name}


async def _job_out(session: AsyncSession, job: AgentJob) -> dict[str, Any]:
    run = await session.get(Run, job.run_id) if job.run_id else None
    task = await session.get(Task, run.task_id) if run else None
    project = await session.get(Project, job.project_id)
    return {
        "jobId": str(job.id),
        "runId": str(job.run_id),
        "runToken": run_token(job.run_id) if job.run_id else None,
        "callbackUrl": get_settings().public_base_url.rstrip("/"),
        "harness": job.engine,
        "projectName": project.name if project else "",
        "taskKey": task.key if task else "",
        "taskTitle": task.title if task else "",
    }


@router.post("/api/agent/jobs/claim")
async def claim_job(session: Session, device: Device, response: Response) -> dict[str, Any] | None:
    """Long-poll: the next job for this machine, or 204 after about 25 seconds."""
    waited = 0.0
    while True:
        job = await devices.claim(session, device)
        await session.commit()
        if job is not None:
            return {"job": await _job_out(session, job)}
        if waited >= CLAIM_WAIT_S:
            response.status_code = status.HTTP_204_NO_CONTENT
            return None
        await asyncio.sleep(CLAIM_POLL_S)
        waited += CLAIM_POLL_S


async def _my_job(session: AsyncSession, device: AgentDevice, job_id: uuid.UUID) -> AgentJob:
    job = await session.get(AgentJob, job_id)
    if job is None or job.device_id != device.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found for this machine.")
    return job


class LogLine(BaseModel):
    """One line of agent output."""

    level: Literal["info", "thinking", "output", "error"] = "info"
    message: str = Field(max_length=4000)


class LogsIn(BaseModel):
    """A batch of log lines."""

    lines: list[LogLine] = Field(max_length=200)


@router.post("/api/agent/jobs/{job_id}/logs", status_code=status.HTTP_204_NO_CONTENT)
async def post_logs(job_id: uuid.UUID, body: LogsIn, session: Session, device: Device) -> None:
    """Stores a batch of log lines and streams them to the project's open tabs."""
    job = await _my_job(session, device, job_id)
    await devices.append_logs(session, job, [(line.level, line.message) for line in body.lines])
    project = await session.get(Project, job.project_id)
    await session.commit()
    if project and project.workspace_id:
        await manager.broadcast(
            str(project.workspace_id),
            {
                "type": "run_log",
                "runId": str(job.run_id),
                "lines": [line.model_dump() for line in body.lines],
            },
        )


class FinishIn(BaseModel):
    """How the job ended on the machine."""

    status: Literal["succeeded", "failed"]
    error: str | None = Field(default=None, max_length=4000)
    worktree: str | None = Field(default=None, max_length=1000)


@router.post("/api/agent/jobs/{job_id}/finish", status_code=status.HTTP_204_NO_CONTENT)
async def finish_job(job_id: uuid.UUID, body: FinishIn, session: Session, device: Device) -> None:
    """Records the job's end. The run result itself goes through /internal/runs."""
    job = await _my_job(session, device, job_id)
    if job.status in ("queued", "running"):
        job.status, job.error, job.sandbox = body.status, body.error, body.worktree
        job.finished_at = devices.now()


@router.get("/api/runs/{run_id}/logs")
async def run_logs(run_id: uuid.UUID, session: Session, user: CurrentUser) -> list[dict[str, Any]]:
    """The machine log of a run, oldest first (live lines arrive as ``run_log`` frames)."""
    run = await session.get(Run, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found.")
    await access.get_visible_project(session, user, run.project_id)
    job = await session.scalar(select(AgentJob).where(AgentJob.run_id == run.id))
    if job is None:
        return []
    rows = (
        await session.scalars(select(AgentJobLog).where(AgentJobLog.job_id == job.id).order_by(AgentJobLog.id))
    ).all()
    return [{"level": r.level, "message": r.message, "at": r.created_at.isoformat()} for r in rows]
