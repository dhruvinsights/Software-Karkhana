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

"""Developer machines: pairing, device tokens, and the build-job queue.

A person asks for a pairing code in the app; ``karkhana-agent login`` trades
it (once, within ten minutes) for a device token. The machine then claims
jobs over plain HTTPS: the oldest queued job for that device is taken with
``FOR UPDATE SKIP LOCKED``, so any number of API instances can serve any
number of machines without coordination. Only SHA-256 digests of the code
and the token are stored.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgentDevice, AgentJob, AgentJobLog, Run, User

PAIRING_TTL = dt.timedelta(minutes=10)
ONLINE_WINDOW = dt.timedelta(seconds=90)  # A machine long-polls every ~25 s.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # No 0/O or 1/I.
HARNESSES = frozenset({"bob", "claude"})  # Adapters shipped in karkhana-agent.


class PairingError(ValueError):
    """The pairing code is unknown, used or expired."""


def _digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def now() -> dt.datetime:
    """The current UTC time."""
    return dt.datetime.now(dt.UTC)


def online(device: AgentDevice) -> bool:
    """True when the machine polled within the last minute and a half."""
    return bool(device.last_seen_at and now() - device.last_seen_at < ONLINE_WINDOW)


async def start_pairing(session: AsyncSession, user: User) -> tuple[AgentDevice, str]:
    """A pending device and its one-time code (shown to the person once)."""
    raw = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
    code = f"{raw[:4]}-{raw[4:]}"
    device = AgentDevice(
        id=uuid.uuid4(),
        user_id=user.id,
        name="New machine",
        pairing_hash=_digest(code),
        pairing_expires_at=now() + PAIRING_TTL,
        status="pending",
    )
    session.add(device)
    await session.flush()
    return device, code


async def complete_pairing(
    session: AsyncSession, *, code: str, name: str, platform: str, harness: str
) -> tuple[AgentDevice, str]:
    """Activates the device for ``code`` and returns its new token (shown once)."""
    device = await session.scalar(
        select(AgentDevice).where(AgentDevice.pairing_hash == _digest(code.strip().upper())).with_for_update()
    )
    if device is None or device.status != "pending":
        raise PairingError("That pairing code is not valid. Create a new one in Software Karkhana.")
    if device.pairing_expires_at is None or device.pairing_expires_at < now():
        raise PairingError("That pairing code has expired. Create a new one in Software Karkhana.")
    token = secrets.token_urlsafe(32)
    device.token_hash = _digest(token)
    device.pairing_hash = device.pairing_expires_at = None
    device.status = "active"
    device.name = name.strip()[:80] or "Developer machine"
    device.platform = platform.strip()[:80]
    device.harness = harness if harness in HARNESSES else "bob"
    device.last_seen_at = now()
    await session.flush()
    return device, token


async def device_for_token(session: AsyncSession, token: str) -> AgentDevice | None:
    """The active device holding ``token``; marks it as seen."""
    device = await session.scalar(
        select(AgentDevice).where(AgentDevice.token_hash == _digest(token), AgentDevice.status == "active")
    )
    if device is not None:
        device.last_seen_at = now()
    return device


async def build_device(session: AsyncSession, user_id: uuid.UUID) -> AgentDevice | None:
    """The person's most recently seen machine, if it is online."""
    device = await session.scalar(
        select(AgentDevice)
        .where(AgentDevice.user_id == user_id, AgentDevice.status == "active")
        .order_by(AgentDevice.last_seen_at.desc().nulls_last())
        .limit(1)
    )
    return device if device is not None and online(device) else None


async def enqueue_build(session: AsyncSession, run: Run, device: AgentDevice, instruction: str) -> AgentJob:
    """Queues ``run`` for ``device``."""
    job = AgentJob(
        id=uuid.uuid4(),
        project_id=run.project_id,
        role="developer",
        engine=device.harness or "bob",
        status="queued",
        instruction=instruction,
        requested_by=run.requested_by,
        device_id=device.id,
        run_id=run.id,
    )
    session.add(job)
    await session.flush()
    return job


async def claim(session: AsyncSession, device: AgentDevice) -> AgentJob | None:
    """Takes the device's oldest queued job, or ``None``. Safe under concurrency."""
    job = await session.scalar(
        select(AgentJob)
        .where(AgentJob.device_id == device.id, AgentJob.status == "queued")
        .order_by(AgentJob.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if job is not None:
        job.status, job.started_at = "running", now()
    return job


async def append_logs(session: AsyncSession, job: AgentJob, lines: list[tuple[str, str]]) -> None:
    """Stores log lines (``(level, message)``) for a job."""
    for level, message in lines:
        session.add(AgentJobLog(job_id=job.id, project_id=job.project_id, level=level, message=message[:4000]))
    await session.flush()
