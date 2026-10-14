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
"""Typed runtime configuration, read once from the environment.

Every setting has a safe default for local development. Production values are
set on the Cloud Run service by ``cloudbuild.yaml`` and secrets come from
Secret Manager through ``--set-secrets``, never from the image.
"""

from __future__ import annotations

import functools
import os
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process-wide settings. Use :func:`get_settings` to read them."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Google Cloud ---------------------------------------------------
    google_cloud_project: str = Field(default="local-dev")
    region: str = Field(default="us-central1")
    # Gemini 3 models are served from the global endpoint.
    genai_location: str = Field(default="global")
    # Gemini 2.5 retires on 2026-10-16, so never default to it. Run
    # `make check-models` in Phase 0 to confirm what this project can call.
    gemini_model: str = Field(default="gemini-3-flash-preview")
    gemini_coder_model: str = Field(default="gemini-3-flash-preview")
    embedding_model: str = Field(default="gemini-embedding-001")
    embedding_location: str = Field(default="us-central1")
    embedding_dim: int = Field(default=768)

    # --- Database --------------------------------------------------------
    # Local: a plain DSN. Cloud Run: set CLOUD_SQL_INSTANCE and the connector
    # uses IAM database authentication with the service account identity.
    database_url: str = Field(
        default="postgresql+asyncpg://karkhana_app:karkhana_app@localhost:5432/karkhana"
    )
    cloud_sql_instance: str | None = None  # "project:region:instance"
    db_iam_user: str | None = None  # e.g. "karkhana-run@PROJECT.iam"
    # Built-in user for the migrate job only (password from Secret Manager).
    db_user: str | None = None
    db_password: str | None = Field(default=None, repr=False)
    db_name: str = "karkhana"

    # --- Auth ------------------------------------------------------------
    # "firebase" verifies Firebase ID tokens. "dev" trusts an X-Dev-User
    # header and is refused on Cloud Run unless explicitly allowed.
    auth_mode: Literal["firebase", "dev"] = "dev"
    allow_dev_auth_on_cloud_run: bool = False
    firebase_project_id: str | None = None

    # --- Agent runs ------------------------------------------------------
    runner_backend: Literal["local", "cloudrun_job"] = "local"
    worker_job_name: str = "karkhana-worker"
    public_base_url: str = "http://localhost:8080"
    run_hmac_secret: str = Field(default="dev-only-change-me", repr=False)
    # One run at a time keeps the shared project stage simple for the demo. The
    # multi-run transitions are still tested with MAX_ACTIVE_RUNS_PER_PROJECT=3.
    max_active_runs_per_project: int = 1
    run_heartbeat_timeout_sec: int = 600

    # --- GitHub ----------------------------------------------------------
    github_token: str | None = Field(default=None, repr=False)
    github_repo: str | None = None  # "owner/name" of the demo repo
    github_base_branch: str = "main"
    github_api_url: str = "https://api.github.com"
    # Optional local clone source for tests and offline demos.
    demo_repo_url: str | None = None

    # --- Demo safety -----------------------------------------------------
    demo_fallback: bool = False  # Serve cached Gemini output if a call fails.
    google_chat_webhook_url: str | None = Field(default=None, repr=False)
    artifacts_bucket: str | None = None

    # --- Web -------------------------------------------------------------
    static_dir: str = "web/dist"
    allow_origins: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _refuse_unsafe_production(self) -> Settings:
        on_cloud_run = bool(
            os.environ.get("K_SERVICE") or os.environ.get("CLOUD_RUN_JOB")
        )
        if (
            on_cloud_run
            and self.auth_mode == "dev"
            and not self.allow_dev_auth_on_cloud_run
        ):
            raise ValueError(
                "AUTH_MODE=dev is not allowed on Cloud Run. Set AUTH_MODE=firebase."
            )
        if on_cloud_run and self.run_hmac_secret == "dev-only-change-me":  # noqa: S105
            raise ValueError(
                "RUN_HMAC_SECRET must come from Secret Manager on Cloud Run."
            )
        return self


@functools.cache
def get_settings() -> Settings:
    """Returns the cached settings for this process."""
    return Settings()
