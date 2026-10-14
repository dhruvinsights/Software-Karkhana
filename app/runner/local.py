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

"""Local backend: runs the real worker as a subprocess of this service.

Used for development and as the on-stage fallback if Cloud Run Jobs are slow
to cold start. It executes the same ``app.worker.main`` as the Job, posting
the same HMAC-authenticated callbacks, so nothing about the run is simulated.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import uuid

from app.runner.base import BackendStatus, StartedRun, worker_env

logger = logging.getLogger(__name__)
_PROCS: dict[str, asyncio.subprocess.Process] = {}


class LocalBackend:
    """Subprocess runner."""

    name = "local"

    async def start(self, run_id: uuid.UUID, env_class: str) -> StartedRun:
        """Spawns ``python -m app.worker.main`` with the run's env."""
        env = {**os.environ, **worker_env(run_id)}
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "app.worker.main", env=env
        )
        external_id = f"pid-{proc.pid}"
        _PROCS[external_id] = proc
        logger.info("Started local worker %s for run %s", external_id, run_id)
        return StartedRun(external_id=external_id)

    async def status(self, external_id: str) -> BackendStatus:
        """Reports whether the subprocess is still alive."""
        proc = _PROCS.get(external_id)
        if proc is None:
            return BackendStatus("unknown", "process not tracked by this instance")
        if proc.returncode is None:
            return BackendStatus("running")
        return BackendStatus(
            "succeeded" if proc.returncode == 0 else "failed", f"exit {proc.returncode}"
        )

    async def cancel(self, external_id: str) -> None:
        """Terminates the subprocess."""
        proc = _PROCS.get(external_id)
        if proc and proc.returncode is None:
            proc.terminate()

    def describe(self) -> dict[str, str]:
        """Facts for the UI."""
        return {"backend": "local", "isolation": "subprocess in the API container"}
