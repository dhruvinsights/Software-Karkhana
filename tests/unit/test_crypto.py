# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Token encryption at rest: roundtrip, rotation, legacy detection, fail-closed."""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from app import crypto
from app.config import Settings, get_settings
from app.crypto import PREFIX, TokenCipher, TokenDecryptError

OLD, NEW = Fernet.generate_key(), Fernet.generate_key()
SECRET = "gho_exampleSecretToken123"


def test_roundtrip_is_tagged_and_not_plaintext():
    c = TokenCipher([NEW])
    stored = c.encrypt(SECRET)
    assert stored.startswith(PREFIX) and SECRET not in stored
    assert crypto.is_encrypted(stored)
    assert c.decrypt(stored) == SECRET
    assert c.encrypt(SECRET) != stored  # random IV per encryption


def test_rotation_old_key_still_decrypts_and_reencrypt_moves_to_primary():
    old_stored = TokenCipher([OLD]).encrypt(SECRET)
    rotated = TokenCipher([NEW, OLD])
    assert rotated.decrypt(old_stored) == SECRET
    assert rotated.needs_reencrypt(old_stored)
    moved = rotated.reencrypt(old_stored)
    assert not rotated.needs_reencrypt(moved)
    # Once OLD is retired, the moved value still decrypts; the old one does not.
    only_new = TokenCipher([NEW])
    assert only_new.decrypt(moved) == SECRET
    with pytest.raises(TokenDecryptError):
        only_new.decrypt(old_stored)


def test_legacy_plaintext_is_detected_and_refused_by_default():
    c = TokenCipher([NEW])
    assert not crypto.is_encrypted(SECRET)
    assert c.needs_reencrypt(SECRET)
    with pytest.raises(TokenDecryptError):
        c.decrypt(SECRET)
    assert c.decrypt(SECRET, allow_plaintext=True) == SECRET
    assert c.decrypt(c.reencrypt(SECRET)) == SECRET


def test_parse_keys_rejects_bad_key_without_echoing_it():
    with pytest.raises(ValueError) as exc:
        crypto.parse_keys(f"{NEW.decode()}, not-a-real-key")
    assert "#2" in str(exc.value) and "not-a-real-key" not in str(exc.value)
    assert crypto.parse_keys(f" {NEW.decode()} ,{OLD.decode()},") == [NEW, OLD]


@pytest.fixture
def fresh_settings(monkeypatch):
    def apply(**env):
        for k, v in env.items():
            if v is None:
                monkeypatch.delenv(k, raising=False)
            else:
                monkeypatch.setenv(k, v)
        get_settings.cache_clear()
        crypto.get_cipher.cache_clear()

    yield apply
    get_settings.cache_clear()
    crypto.get_cipher.cache_clear()


def test_fail_closed_outside_dev_without_keys(fresh_settings):
    fresh_settings(AUTH_MODE="firebase", TOKEN_ENCRYPTION_KEYS=None)
    with pytest.raises(crypto.TokenEncryptionNotConfigured):
        crypto.get_cipher()


def test_fail_closed_on_invalid_key(fresh_settings):
    fresh_settings(AUTH_MODE="firebase", TOKEN_ENCRYPTION_KEYS="garbage")
    with pytest.raises(crypto.TokenEncryptionNotConfigured):
        crypto.get_cipher()


def test_dev_mode_uses_ephemeral_key_with_warning(fresh_settings, caplog):
    fresh_settings(AUTH_MODE="dev", TOKEN_ENCRYPTION_KEYS=None)
    c = crypto.get_cipher()
    assert c.decrypt(c.encrypt(SECRET)) == SECRET
    assert "ephemeral" in caplog.text


def test_cloud_run_service_requires_keys(monkeypatch):
    monkeypatch.setenv("K_SERVICE", "karkhana")
    monkeypatch.setenv("AUTH_MODE", "firebase")
    monkeypatch.setenv("RUN_HMAC_SECRET", "from-secret-manager")
    monkeypatch.delenv("TOKEN_ENCRYPTION_KEYS", raising=False)
    with pytest.raises(ValueError, match="TOKEN_ENCRYPTION_KEYS"):
        Settings()
    monkeypatch.setenv("TOKEN_ENCRYPTION_KEYS", NEW.decode())
    assert Settings().token_encryption_keys


def test_settings_repr_hides_keys(monkeypatch):
    monkeypatch.setenv("TOKEN_ENCRYPTION_KEYS", NEW.decode())
    assert NEW.decode() not in repr(Settings())


def test_user_token_takes_precedence_over_server_token(monkeypatch):
    from app.integrations import github

    monkeypatch.setenv("GITHUB_REPO", "acme/demo")
    monkeypatch.setenv("GITHUB_TOKEN", "server-token")
    get_settings.cache_clear()
    try:
        gh = github.client("user-token")
        assert gh is not None
        assert gh._http.headers["Authorization"].endswith("user-token")
        assert github.client()._http.headers["Authorization"].endswith("server-token")
    finally:
        get_settings.cache_clear()
