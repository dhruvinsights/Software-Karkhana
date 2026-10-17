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

"""Device backend: the run executes on the requester's own machine.

``start`` queues an ``agent_jobs`` row for the requester's online machine;
the machine's ``karkhana-agent`` claims it, fetches the same run spec as the
cloud worker, codes in a local git worktree with the developer's harness,
runs the repository's tests and reports through the same HMAC-signed
``/internal/runs`` callbacks. Publishing and review stay in the control plane.
"""

from __future__ import annotations

import uuid

from app.db import sessionmaker
from app.models import AgentJob, Run, Task
from app.runner.base import BackendStatus, StartedRun
from app.services import devices

_STATE = {"queued": "running", "running": "running", "succeeded": "succeeded", "failed": "failed", "cancelled": "failed"}


class NoMachineError(RuntimeError):
    """The requester has no online machine."""


class DeviceBackend:
    """Runs on a paired developer machine."""

    name = "device"

    async def start(self, run_id: uuid.UUID, env_class: str) -> StartedRun:
        """Queues the run for the requester's online machine."""
        async with sessionmaker()() as session:
            run = await session.get(Run, run_id)
            assert run is not None and run.requested_by is not None
            device = await devices.build_device(session, run.requested_by)
            if device is None:
                raise NoMachineError(
                    "No machine is connected. Run `karkhana-agent work` on your computer and try again."
                )
            task = await session.get(Task, run.task_id)
            job = await devices.enqueue_build(session, run, device, f"{task.key}: {task.title}" if task else "")
            await session.commit()
            return StartedRun(external_id=f"job-{job.id}")

    async def status(self, external_id: str) -> BackendStatus:
        """The job's state as the machine last reported it."""
        async with sessionmaker()() as session:
            job = await session.get(AgentJob, uuid.UUID(external_id.removeprefix("job-")))
            if job is None:
                return BackendStatus("unknown", "job not found")
            return BackendStatus(_STATE.get(job.status, "unknown"), job.error or "")

    async def cancel(self, external_id: str) -> None:
        """Cancels a job the machine has not finished."""
        async with sessionmaker()() as session:
            job = await session.get(AgentJob, uuid.UUID(external_id.removeprefix("job-")))
            if job is not None and job.status in ("queued", "running"):
                job.status = "cancelled"
                await session.commit()

    def describe(self) -> dict[str, str]:
        """Facts for the UI and the ledger."""
        return {"backend": "device", "isolation": "the developer's machine, in a git worktree"}
