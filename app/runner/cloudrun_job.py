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

"""Cloud Run Jobs backend: one Job execution per run (hackathon default).

The Job ``karkhana-worker`` runs the same container image with the command
``python -m app.worker.main`` under its own least-privilege service account.
Each run overrides only the environment, so executions are isolated,
scale to zero, and get IAM and Secret Manager for free.
"""

from __future__ import annotations

import logging
import uuid

from google.cloud import run_v2

from app.config import get_settings
from app.runner.base import BackendStatus, StartedRun, worker_env

logger = logging.getLogger(__name__)

# Environment classes from ADR-001. Timeouts are per execution.
ENV_CLASSES = {
    "small": {"timeout_s": 600},
    "standard": {"timeout_s": 1200},
    "large": {"timeout_s": 2400},
}


class CloudRunJobBackend:
    """Starts and inspects Cloud Run Job executions."""

    name = "cloudrun_job"

    def __init__(self) -> None:
        s = get_settings()
        self._job = f"projects/{s.google_cloud_project}/locations/{s.region}/jobs/{s.worker_job_name}"

    async def start(self, run_id: uuid.UUID, env_class: str) -> StartedRun:
        """Runs the Job with per-run env overrides and returns the execution name."""
        cls = ENV_CLASSES.get(env_class, ENV_CLASSES["standard"])
        env = [run_v2.EnvVar(name=k, value=v) for k, v in worker_env(run_id).items()]
        request = run_v2.RunJobRequest(
            name=self._job,
            overrides=run_v2.RunJobRequest.Overrides(
                container_overrides=[
                    run_v2.RunJobRequest.Overrides.ContainerOverride(env=env)
                ],
                task_count=1,
                timeout={"seconds": cls["timeout_s"]},
            ),
        )
        client = run_v2.JobsAsyncClient()
        operation = await client.run_job(request=request)
        # The operation metadata is the Execution; its name is our external id.
        execution = operation.metadata
        name = getattr(execution, "name", "") or f"{self._job}/executions/unknown"
        logger.info("Started Cloud Run Job execution %s for run %s", name, run_id)
        return StartedRun(external_id=name)

    async def status(self, external_id: str) -> BackendStatus:
        """Maps the Execution's counters to a coarse state."""
        try:
            ex = await run_v2.ExecutionsAsyncClient().get_execution(name=external_id)
        except Exception as exc:
            return BackendStatus("unknown", str(exc))
        if ex.succeeded_count:
            return BackendStatus("succeeded")
        if ex.failed_count or ex.cancelled_count:
            return BackendStatus("failed", "execution failed or was cancelled")
        return BackendStatus("running")

    async def cancel(self, external_id: str) -> None:
        """Cancels the Execution."""
        await run_v2.ExecutionsAsyncClient().cancel_execution(name=external_id)

    def describe(self) -> dict[str, str]:
        """Facts for the UI."""
        return {
            "backend": "cloudrun_job",
            "job": self._job,
            "isolation": "one Job execution per run",
        }
