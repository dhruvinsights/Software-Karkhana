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

"""Runner contract from ADR-001: start / status / cancel / describe.

The control plane talks to every backend through this interface, so moving a
run from an in-process subprocess to a Cloud Run Job (or later to Agent
Substrate or a customer's own runner) is a config change, not a code change.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from dataclasses import dataclass
from typing import Protocol

from app.config import get_settings


@dataclass(frozen=True)
class StartedRun:
    """What a backend returns when it accepts a run."""

    external_id: str


@dataclass(frozen=True)
class BackendStatus:
    """A backend's own view of a run, used when heartbeats stop."""

    state: str  # "running" | "succeeded" | "failed" | "unknown"
    detail: str = ""


class RunnerBackend(Protocol):
    """Interface every execution backend implements."""

    name: str

    async def start(self, run_id: uuid.UUID, env_class: str) -> StartedRun:
        """Starts the worker for ``run_id``."""
        ...

    async def status(self, external_id: str) -> BackendStatus:
        """Reports the backend's view of a run."""
        ...

    async def cancel(self, external_id: str) -> None:
        """Stops a run if it is still going."""
        ...

    def describe(self) -> dict[str, str]:
        """Human-readable facts for the UI and the ledger."""
        ...


def run_token(run_id: uuid.UUID | str) -> str:
    """Per-run HMAC token. The worker holds only this, never user credentials."""
    secret = get_settings().run_hmac_secret.encode()
    return hmac.new(secret, f"run:{run_id}".encode(), hashlib.sha256).hexdigest()


def verify_run_token(run_id: uuid.UUID | str, token: str) -> bool:
    """Constant-time check of a worker's token."""
    return hmac.compare_digest(run_token(run_id), token)


def worker_env(run_id: uuid.UUID) -> dict[str, str]:
    """Environment variables a worker needs to call back."""
    s = get_settings()
    return {
        "RUN_ID": str(run_id),
        "RUN_TOKEN": run_token(run_id),
        "CALLBACK_URL": s.public_base_url.rstrip("/"),
    }


def get_backend(name: str | None = None) -> RunnerBackend:
    """Returns the backend called ``name``, else the configured one."""
    backend = name or get_settings().runner_backend
    if backend == "device":
        from app.runner.device import DeviceBackend

        return DeviceBackend()
    if backend == "cloudrun_job":
        from app.runner.cloudrun_job import CloudRunJobBackend

        return CloudRunJobBackend()
    if backend == "ax":
        from app.runner.ax import AxBackend

        return AxBackend()
    from app.runner.local import LocalBackend

    return LocalBackend()
