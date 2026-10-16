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
"""Regression tests for the auth hardening track.

- X-Dev-User never signs anyone in outside AUTH_MODE=dev (HTTP level).
- Session JWTs use their own key and a ``typ`` claim; run tokens never pass.
- The local runner hands the worker an allowlisted environment, no secrets.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import time
import uuid
from types import SimpleNamespace
from typing import Annotated
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import Depends, FastAPI

from app import auth
from app.config import DEV_SESSION_JWT_SECRET, Settings, get_settings
from app.db import get_session


def _settings(**kw):
    base = {
        "auth_mode": "dev",
        "session_jwt_secret": "unit-session-secret",
        "run_hmac_secret": "unit-run-secret",
    }
    return SimpleNamespace(**{**base, **kw})


def _app(monkeypatch, settings, user=None):
    monkeypatch.setattr(auth, "get_settings", lambda: settings)
    app = FastAPI()
    session = AsyncMock()
    session.scalar.return_value = user

    async def _session():
        yield session

    app.dependency_overrides[get_session] = _session

    @app.get("/whoami")
    async def whoami(u: Annotated[object, Depends(auth.current_user)]):
        return {"email": u.email}

    return app, session


async def _get(app, headers):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    ) as c:
        return await c.get("/whoami", headers=headers)


# --- X-Dev-User --------------------------------------------------------------


@pytest.mark.parametrize("mode", ["firebase", "prod", "staging", ""])
async def test_dev_header_alone_is_401_outside_dev_mode(monkeypatch, mode):
    app, session = _app(monkeypatch, _settings(auth_mode=mode))
    r = await _get(app, {"X-Dev-User": "someone@x.com"})
    assert r.status_code == 401
    session.scalar.assert_not_called()  # never even looked the victim up


async def test_dev_header_with_a_bad_token_is_401_in_firebase_mode(monkeypatch):
    app, _ = _app(monkeypatch, _settings(auth_mode="firebase"))

    async def reject(token):
        from fastapi import HTTPException

        raise HTTPException(401, "Invalid or expired sign-in")

    monkeypatch.setattr(auth, "_verify_firebase_token", reject)
    r = await _get(app, {"X-Dev-User": "someone@x.com", "Authorization": "Bearer junk"})
    assert r.status_code == 401


async def test_dev_header_still_works_in_dev_mode(monkeypatch):
    user = SimpleNamespace(id=uuid.uuid4(), email="someone@x.com")
    app, _ = _app(monkeypatch, _settings(auth_mode="dev"), user=user)
    r = await _get(app, {"X-Dev-User": "someone@x.com"})
    assert r.status_code == 200 and r.json()["email"] == "someone@x.com"


# --- Session tokens vs run tokens ---------------------------------------------


def _sign(secret: str, body: dict, header: dict | None = None) -> str:
    def enc(d):
        raw = json.dumps(d, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    signing = f"{enc(header or {'alg': 'HS256', 'typ': 'JWT'})}.{enc(body)}"
    sig = hmac.new(secret.encode(), signing.encode(), hashlib.sha256).digest()
    return f"{signing}.{base64.urlsafe_b64encode(sig).decode().rstrip('=')}"


def test_session_token_roundtrip_carries_typ(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: _settings())
    body = auth.decode_token(auth.create_token({"email": "a@b.c"}))
    assert body["email"] == "a@b.c" and body["typ"] == "session"


def test_token_signed_with_run_secret_is_not_a_session(monkeypatch):
    s = _settings()
    monkeypatch.setattr(auth, "get_settings", lambda: s)
    forged = _sign(
        s.run_hmac_secret, {"email": "a@b.c", "typ": "session", "exp": time.time() + 60}
    )
    assert auth.decode_token(forged) is None


def test_untyped_or_wrong_alg_tokens_are_rejected(monkeypatch):
    s = _settings()
    monkeypatch.setattr(auth, "get_settings", lambda: s)
    exp = time.time() + 60
    assert (
        auth.decode_token(_sign(s.session_jwt_secret, {"email": "a@b.c", "exp": exp}))
        is None
    )
    assert (
        auth.decode_token(
            _sign(
                s.session_jwt_secret,
                {"email": "a@b.c", "typ": "session", "exp": exp},
                header={"alg": "none"},
            )
        )
        is None
    )
    assert (
        auth.decode_token(
            _sign(
                s.session_jwt_secret,
                {"email": "a@b.c", "typ": "session", "exp": time.time() - 1},
            )
        )
        is None
    )


def test_run_token_is_not_a_session(monkeypatch):
    from app.runner import base

    monkeypatch.setattr(auth, "get_settings", lambda: _settings())
    assert auth.decode_token(base.run_token(uuid.uuid4())) is None


@pytest.mark.parametrize("mode", ["firebase", "prod"])
def test_dev_default_secret_is_refused_outside_dev(monkeypatch, mode):
    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: _settings(auth_mode=mode, session_jwt_secret=DEV_SESSION_JWT_SECRET),
    )
    with pytest.raises(auth.AuthConfigError):
        auth.create_token({"email": "a@b.c"})
    # A token made with the public default never verifies either.
    forged = _sign(
        DEV_SESSION_JWT_SECRET,
        {"email": "a@b.c", "typ": "session", "exp": time.time() + 60},
    )
    assert auth.decode_token(forged) is None


def test_missing_secret_fails_closed_outside_dev(monkeypatch):
    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: _settings(auth_mode="firebase", session_jwt_secret=""),
    )
    with pytest.raises(auth.AuthConfigError):
        auth.create_token({"email": "a@b.c"})


def test_missing_secret_in_dev_uses_an_ephemeral_key(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: _settings(session_jwt_secret=""))
    monkeypatch.setattr(auth, "_EPHEMERAL_DEV_SECRET", None)
    token = auth.create_token({"email": "a@b.c"})
    assert auth.decode_token(token)["email"] == "a@b.c"
    assert auth._EPHEMERAL_DEV_SECRET and len(auth._EPHEMERAL_DEV_SECRET) == 32


def test_shared_session_and_run_secret_is_refused(monkeypatch):
    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: _settings(session_jwt_secret="same", run_hmac_secret="same"),
    )
    with pytest.raises(auth.AuthConfigError):
        auth.create_token({"email": "a@b.c"})
    with pytest.raises(ValueError, match="differ"):
        Settings(session_jwt_secret="same", run_hmac_secret="same")


def test_cloud_run_service_refuses_default_session_secret(monkeypatch):
    monkeypatch.setenv("K_SERVICE", "karkhana")
    monkeypatch.delenv("SESSION_JWT_SECRET", raising=False)
    with pytest.raises(ValueError, match="SESSION_JWT_SECRET"):
        Settings(
            auth_mode="firebase", run_hmac_secret="x" * 32, token_encryption_keys="k"
        )


def test_cloud_run_jobs_need_no_session_secret(monkeypatch):
    # The worker and migrate Jobs never authenticate people.
    monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.setenv("CLOUD_RUN_JOB", "karkhana-worker")
    for var in ("SESSION_JWT_SECRET", "RUN_HMAC_SECRET", "AUTH_MODE"):
        monkeypatch.delenv(var, raising=False)
    Settings()  # does not raise


# --- Local runner environment -------------------------------------------------

SECRETS = {
    "SESSION_JWT_SECRET": "s3ss10n",
    "RUN_HMAC_SECRET": "run-s3cret",
    "DATABASE_URL": "postgresql+asyncpg://karkhana_owner:owner-pw@db/karkhana",
    "DB_PASSWORD": "owner-pw",
    "GITHUB_TOKEN": "ghp_secret",
    "GH_TOKEN": "ghp_secret2",
    "GITHUB_CLIENT_SECRET": "gh-client-secret",
    "RESEND_API_KEY": "re_secret",
    "GOOGLE_CLIENT_SECRET": "goog-secret",
    "FIREBASE_WEB_API_KEY": "fb-key",
    "FIREBASE_SERVICE_ACCOUNT": "{...}",
    "TOKEN_ENCRYPTION_KEYS": "enc-key",
    "GOOGLE_CHAT_WEBHOOK_URL": "https://chat/secret",
    "AWS_SECRET_ACCESS_KEY": "aws",
}


async def test_local_runner_passes_no_secrets_to_the_worker(monkeypatch):
    from app.runner import local

    for k, v in SECRETS.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("GEMINI_API_KEY", "model-key")
    monkeypatch.setenv("LC_ALL", "C.UTF-8")
    get_settings.cache_clear()
    captured = {}

    async def fake_exec(*argv, env=None, **kw):
        captured["argv"], captured["env"] = argv, env
        return SimpleNamespace(pid=4242, returncode=None)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    try:
        run_id = uuid.uuid4()
        started = await local.LocalBackend().start(run_id, "standard")
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()
        local._PROCS.pop(started.external_id, None)

    env = captured["env"]
    leaked = {k for k in SECRETS if k in env}
    assert not leaked, f"secrets reached the worker: {leaked}"
    values = "\n".join(env.values())
    for v in SECRETS.values():
        assert v not in values
    # What the worker does need is there.
    assert env["RUN_ID"] == str(run_id) and env["RUN_TOKEN"] and env["CALLBACK_URL"]
    assert env["KARKHANA_NO_DOTENV"] == "1"  # it will not read the API's .env
    assert env["GEMINI_API_KEY"] == "model-key"
    assert env["PATH"] and env["LC_ALL"] == "C.UTF-8"
    assert captured["argv"][1:] == ("-m", "app.worker.main")


def test_pr_agent_review_env_carries_no_platform_secrets(monkeypatch):
    from app.review import pr_agent

    for k in ("SESSION_JWT_SECRET", "RUN_HMAC_SECRET", "TOKEN_ENCRYPTION_KEYS", "GITHUB_TOKEN", "DATABASE_URL"):
        monkeypatch.setenv(k, "leak")
    env = pr_agent._passthrough_env()
    assert not {"SESSION_JWT_SECRET", "RUN_HMAC_SECRET", "TOKEN_ENCRYPTION_KEYS", "GITHUB_TOKEN", "DATABASE_URL"} & set(env)
    assert "PATH" in env


async def test_gemini_endpoints_require_sign_in():
    from httpx import ASGITransport, AsyncClient

    from app.fast_api_app import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/api/gemini/ideas", json={})
    assert r.status_code in (401, 403)
