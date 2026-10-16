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

DEV_SESSION_JWT_SECRET = "dev-session-secret-change-me"  # noqa: S105 - dev default


class Settings(BaseSettings):
    """Process-wide settings. Use :func:`get_settings` to read them."""

    # The local runner sets KARKHANA_NO_DOTENV=1 for the worker subprocess so
    # it cannot pick up the API's secrets from .env; it gets only what the
    # runner passes explicitly (see app.runner.local).
    model_config = SettingsConfigDict(
        env_file=None if os.environ.get("KARKHANA_NO_DOTENV") else ".env",
        extra="ignore",
    )

    # --- Model providers -----------------------------------------------
    # Two providers only: Gemini (hosted) and Ollama (local). Chat and
    # embeddings are chosen independently, so you can run Gemini for text and
    # Ollama's nomic-embed-text for vectors.
    llm_provider: Literal["gemini", "ollama"] = "gemini"
    embed_provider: Literal["gemini", "ollama"] = "gemini"

    # Gemini through a Google AI Studio key (GEMINI_API_KEY), or through
    # Vertex AI with the service account when no key is set.
    gemini_api_key: str | None = Field(default=None, repr=False)

    # Ollama (local). nomic-embed-text returns 768-d vectors, which matches
    # the learnings.embedding column, so switching providers needs no schema
    # change. Vectors from different models are never compared: each row
    # records which model made it.
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5-coder:14b"
    ollama_coder_model: str = "qwen2.5-coder:14b"
    ollama_embed_model: str = "nomic-embed-text"
    ollama_timeout_s: float = 300.0

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
    # "ax" submits the run as a google/ax Task on Kubernetes + Agent Substrate.
    runner_backend: Literal["local", "cloudrun_job", "ax"] = "local"
    ax_bin: str = "ax"  # Path to the ax CLI (built from third_party/ax).
    ax_server: str | None = None  # AX API server host:port; unset = kube context.
    ax_atespace: str = "karkhana"
    axcheck_bin: str | None = None  # Built from tools/axcheck; validates manifests.
    ax_task_image: str | None = None  # Image that contains this app's worker.
    ax_model_secret: str = "gemini-api-secret"  # noqa: S105 - a Secret *name*
    worker_job_name: str = "karkhana-worker"
    public_base_url: str = "http://localhost:8080"
    # Signs per-run worker callback tokens ONLY. Never used for user sessions.
    run_hmac_secret: str = Field(default="dev-only-change-me", repr=False)
    # Signs user session JWTs (OTP / password / OAuth sign-in) only. A separate
    # key from RUN_HMAC_SECRET, so a worker run token can never become a
    # session. The default works only in AUTH_MODE=dev (app.auth refuses it in
    # any other mode) and is refused outright on Cloud Run.
    session_jwt_secret: str = Field(default=DEV_SESSION_JWT_SECRET, repr=False)
    # One run at a time keeps the shared project stage simple for the demo. The
    # multi-run transitions are still tested with MAX_ACTIVE_RUNS_PER_PROJECT=3.
    max_active_runs_per_project: int = 1
    run_heartbeat_timeout_sec: int = 600

    # --- GitHub ----------------------------------------------------------
    github_token: str | None = Field(default=None, repr=False)
    github_repo: str | None = None  # "owner/name" of the demo repo
    github_base_branch: str = "main"
    github_api_url: str = "https://api.github.com"
    # Comma-separated Fernet keys for encrypting stored OAuth tokens; the first
    # encrypts, all decrypt (rotation). Required outside AUTH_MODE=dev. See
    # app/crypto.py.
    token_encryption_keys: str | None = Field(default=None, repr=False)
    # Optional local clone source for tests and offline demos.
    demo_repo_url: str | None = None

    # --- Review engine ---------------------------------------------------
    # "pr_agent" runs The-PR-Agent/pr-agent (MIT) in its own virtualenv in
    # plain-diff mode. "adk" uses the built-in ADK reviewer agent.
    review_engine: Literal["pr_agent", "adk"] = "adk"
    pr_agent_python: str | None = None  # Python of the isolated pr-agent venv.
    review_timeout_s: float = 300.0

    # --- Context compression (Headroom) ----------------------------------
    # Every prompt, tool output and document we send to a model goes through
    # app/ai/compression.py. "lossless" (default) only applies Headroom's
    # verified, reversible-in-text densification: the model sees every byte
    # of information. "aggressive" also lets Headroom drop low-value content,
    # but never with CCR (originals parked in a store for later retrieval), so
    # nothing tenant-owned outlives the call. See app/ai/compression.py.
    headroom_enabled: bool = True
    headroom_mode: Literal["lossless", "aggressive"] = "lossless"
    # Content shorter than this is sent as-is (not worth the CPU).
    headroom_min_chars: int = 1200
    # Headroom's master no-egress switch: no telemetry, no model downloads.
    headroom_offline: bool = True
    # Aggressive mode only: allow the Kompress ML text compressor if its model
    # is already cached locally (offline mode never downloads it).
    headroom_kompress: bool = False

    # --- Shared context --------------------------------------------------
    # Directory of Markdown context files kept in Git (TeamContext-style).
    context_dir: str = ".karkhana/context"

    google_chat_webhook_url: str | None = Field(default=None, repr=False)
    artifacts_bucket: str | None = None

    # --- Ledger anchoring ------------------------------------------------
    # Every N entries in a chain (0 = never), and on demand, the chain head
    # is written outside the database so a rewrite by a DB owner is caught.
    # Production: a bucket with a locked retention policy (infra/bootstrap.sh).
    # Unset bucket: a local JSONL file (dev and tests only; ephemeral on Cloud Run).
    ledger_anchor_every: int = 50
    ledger_anchor_bucket: str | None = None
    ledger_anchor_prefix: str = "ledger-anchors"
    ledger_anchor_path: str = ".ledger-anchors.jsonl"

    # --- Email (Resend) --------------------------------------------------
    # Used for transactional email (invites, notifications, magic links).
    # Set RESEND_API_KEY in .env locally or via Secret Manager on Cloud Run.
    # EMAIL_FROM must use a domain verified in your Resend dashboard.
    resend_api_key: str | None = Field(default=None, repr=False)
    # Public base URL of the app, used in invite emails (APP_URL).
    app_url: str | None = None
    email_from: str = "onboarding@visiarise.com"
    email_from_team: str = "team@visiarise.com"

    # --- OAuth (Google & GitHub) -----------------------------------------
    google_client_id: str | None = Field(default=None, repr=False)
    google_client_secret: str | None = Field(default=None, repr=False)
    github_client_id: str | None = None
    github_client_secret: str | None = Field(default=None, repr=False)

    # --- Web -------------------------------------------------------------
    static_dir: str = "web/dist"
    allow_origins: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _refuse_unsafe_production(self) -> Settings:
        # Only the API *service* (K_SERVICE) authenticates people. The worker and
        # migrate Jobs (CLOUD_RUN_JOB) hold no session or run-signing secret.
        on_cloud_run_service = bool(os.environ.get("K_SERVICE"))
        if (
            on_cloud_run_service
            and self.auth_mode == "dev"
            and not self.allow_dev_auth_on_cloud_run
        ):
            raise ValueError(
                "AUTH_MODE=dev is not allowed on Cloud Run. Set AUTH_MODE=firebase."
            )
        if on_cloud_run_service and self.run_hmac_secret == "dev-only-change-me":  # noqa: S105
            raise ValueError(
                "RUN_HMAC_SECRET must come from Secret Manager on Cloud Run."
            )
        if on_cloud_run_service and (
            not self.session_jwt_secret
            or self.session_jwt_secret == DEV_SESSION_JWT_SECRET
        ):
            raise ValueError(
                "SESSION_JWT_SECRET must come from Secret Manager on Cloud Run "
                "(and must not use the development default)."
            )
        if self.session_jwt_secret and self.session_jwt_secret == self.run_hmac_secret:
            raise ValueError("SESSION_JWT_SECRET must differ from RUN_HMAC_SECRET.")
        # The API service stores OAuth tokens; jobs (worker, migrate) do not.
        if on_cloud_run_service and not self.token_encryption_keys:
            raise ValueError(
                "TOKEN_ENCRYPTION_KEYS must come from Secret Manager on Cloud Run."
            )
        return self


@functools.cache
def get_settings() -> Settings:
    """Returns the cached settings for this process."""
    return Settings()
