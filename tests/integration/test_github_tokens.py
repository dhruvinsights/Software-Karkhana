# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""GitHub OAuth tokens are encrypted at rest and never returned by the API."""

from __future__ import annotations

import uuid

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import crypto, db
from app.config import get_settings
from app.integrations import github as gh_module
from app.integrations import github_tokens
from app.scripts.reencrypt_tokens import reencrypt
from tests.integration.test_golden_path import DEV, LEAD, as_, client  # noqa: F401

SECRET = "gho_integrationSecret_" + uuid.uuid4().hex


class FakeOAuth:
    SCOPES = "repo,read:org"

    def __init__(self, token):
        self.token = token

    async def poll(self, device_code):
        return self.token

    async def aclose(self):
        pass


async def _uid(client, who):
    return uuid.UUID((await client.get("/api/me", headers=as_(who))).json()["id"])


async def _raw(user_id):
    async with db.sessionmaker()() as s:
        return await s.scalar(
            text("SELECT token FROM github_tokens WHERE user_id = :u"), {"u": user_id}
        )


@pytest.fixture
async def owner_sessions(database):
    engine = create_async_engine(database)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture(autouse=True)
async def _clean(client):
    yield
    async with db.sessionmaker()() as s:
        await s.execute(text("DELETE FROM github_tokens"))
        await s.commit()
    get_settings.cache_clear()
    crypto.get_cipher.cache_clear()


async def test_device_flow_stores_ciphertext_and_never_returns_token(
    client, monkeypatch
):
    monkeypatch.setattr(gh_module, "oauth_client", lambda: FakeOAuth(SECRET))
    r = await client.post("/api/github/auth/poll?device_code=abc", headers=as_(DEV))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "granted"
    assert SECRET not in r.text and "token" not in r.json()

    uid = await _uid(client, DEV)
    raw = await _raw(uid)
    assert raw.startswith(crypto.PREFIX) and SECRET not in raw
    async with db.sessionmaker()() as s:
        assert await github_tokens.load_token(s, uid) == SECRET

    st = await client.get("/api/github/auth/status", headers=as_(DEV))
    assert st.json()["connected"] is True and SECRET not in st.text
    assert (await client.get("/api/github/auth/status", headers=as_(LEAD))).json()[
        "connected"
    ] is False

    # Reconnecting replaces the row; disconnecting deletes it.
    monkeypatch.setattr(gh_module, "oauth_client", lambda: FakeOAuth(SECRET + "2"))
    await client.post("/api/github/auth/poll?device_code=abc", headers=as_(DEV))
    async with db.sessionmaker()() as s:
        assert await github_tokens.load_token(s, uid) == SECRET + "2"
    assert (
        await client.delete("/api/github/auth", headers=as_(DEV))
    ).status_code == 204
    assert await _raw(uid) is None


async def test_database_rejects_plaintext_writes(client):
    uid = await _uid(client, DEV)
    async with db.sessionmaker()() as s:
        with pytest.raises(Exception, match="github_tokens_token_encrypted"):
            await s.execute(
                text("INSERT INTO github_tokens (user_id, token) VALUES (:u, :t)"),
                {"u": uid, "t": SECRET},
            )


async def test_reencrypt_script_fixes_legacy_rows_and_rotates(
    client, owner_sessions, monkeypatch
):
    dev, lead = await _uid(client, DEV), await _uid(client, LEAD)
    old_key = get_settings().token_encryption_keys
    async with db.sessionmaker()() as s:
        await github_tokens.save_token(s, lead, SECRET + "-lead")
        await s.commit()
    # A legacy plaintext row from before migration 013 (bypass the CHECK as owner).
    async with owner_sessions() as s:
        await s.execute(
            text(
                "ALTER TABLE github_tokens DROP CONSTRAINT github_tokens_token_encrypted"
            )
        )
        await s.execute(
            text("INSERT INTO github_tokens (user_id, token) VALUES (:u, :t)"),
            {"u": dev, "t": SECRET},
        )
        await s.execute(
            text(
                "ALTER TABLE github_tokens ADD CONSTRAINT github_tokens_token_encrypted "
                "CHECK (token LIKE 'fernet:v1:%') NOT VALID"
            )
        )
        await s.commit()
    async with db.sessionmaker()() as s:  # Still usable before the script runs.
        assert await github_tokens.load_token(s, dev) == SECRET

    dry = await reencrypt(dry_run=True, sessionmaker=owner_sessions)
    assert (dry.plaintext, dry.unchanged) == (1, 1) and await _raw(dev) == SECRET

    r = await reencrypt(sessionmaker=owner_sessions)
    assert (r.plaintext, r.rotated, r.unchanged, r.validated) == (1, 0, 1, True)
    assert (await _raw(dev)).startswith(crypto.PREFIX)
    again = await reencrypt(sessionmaker=owner_sessions)  # idempotent
    assert (again.plaintext, again.rotated, again.unchanged) == (0, 0, 2)

    # Rotate: prepend a new key, re-encrypt, then retire the old one.
    new_key = Fernet.generate_key().decode()
    monkeypatch.setenv("TOKEN_ENCRYPTION_KEYS", f"{new_key},{old_key}")
    get_settings.cache_clear()
    crypto.get_cipher.cache_clear()
    r = await reencrypt(sessionmaker=owner_sessions)
    assert (r.rotated, r.unchanged) == (2, 0)
    monkeypatch.setenv("TOKEN_ENCRYPTION_KEYS", new_key)
    get_settings.cache_clear()
    crypto.get_cipher.cache_clear()
    async with db.sessionmaker()() as s:
        assert await github_tokens.load_token(s, dev) == SECRET
        assert await github_tokens.load_token(s, lead) == SECRET + "-lead"
