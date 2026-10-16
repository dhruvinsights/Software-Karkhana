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

The worker runs untrusted repository code, so it does **not** inherit this
service's environment. It gets an explicit allowlist: basic OS variables, the
run's callback credentials, and the model/review settings it needs (taken from
the API's resolved settings, so values from ``.env`` still reach it). It never
sees SESSION_JWT_SECRET, RUN_HMAC_SECRET, DATABASE_URL, GitHub, Resend, OAuth
or Firebase credentials, and it is told not to read ``.env`` itself.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import uuid

from app.config import get_settings
from app.runner.base import BackendStatus, StartedRun, worker_env

logger = logging.getLogger(__name__)

# OS variables passed through unchanged when present.
_OS_PASSTHROUGH = (
    "PATH",
    "HOME",
    "LANG",
    "TZ",
    "TMPDIR",
    "TEMP",
    "TMP",
    "VIRTUAL_ENV",
    "PYTHONPATH",
    # Windows needs these for sockets, asyncio and subprocesses.
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    # TLS trust for outbound model calls behind a corporate proxy.
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
    # Application Default Credentials for Vertex AI (no key file is copied).
    "GOOGLE_APPLICATION_CREDENTIALS",
    "CLOUDSDK_CONFIG",
)

# Settings the worker reads (app.worker, app.agents, app.review), by field name.
# Everything else in Settings stays in the API process.
_WORKER_SETTINGS = (
    "llm_provider",
    "embed_provider",
    "gemini_api_key",
    "ollama_base_url",
    "ollama_model",
    "ollama_coder_model",
    "ollama_embed_model",
    "ollama_timeout_s",
    "google_cloud_project",
    "region",
    "genai_location",
    "gemini_model",
    "gemini_coder_model",
    "embedding_model",
    "embedding_location",
    "embedding_dim",
    "review_engine",
    "pr_agent_python",
    "review_timeout_s",
    "artifacts_bucket",
)


def build_worker_env(run_id: uuid.UUID) -> dict[str, str]:
    """The complete environment for a local worker: an allowlist, never ``os.environ``."""
    env = {k: v for k, v in os.environ.items() if k in _OS_PASSTHROUGH or k.startswith("LC_")}
    settings = get_settings()
    for field in _WORKER_SETTINGS:
        value = getattr(settings, field, None)
        if value is not None:
            env[field.upper()] = str(value)
    env.update(worker_env(run_id))
    # The worker must not load the API's .env (which holds the API's secrets).
    env["KARKHANA_NO_DOTENV"] = "1"
    env.setdefault("PATH", os.defpath)
    return env


_PROCS: dict[str, asyncio.subprocess.Process] = {}


class LocalBackend:
    """Subprocess runner."""

    name = "local"

    async def start(self, run_id: uuid.UUID, env_class: str) -> StartedRun:
        """Spawns ``python -m app.worker.main`` with the run's env."""
        env = build_worker_env(run_id)
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
