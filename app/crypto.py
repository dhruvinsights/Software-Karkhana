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

"""Encryption at rest for stored third-party secrets (GitHub OAuth tokens).

Values are encrypted with Fernet (AES-128-CBC + HMAC-SHA256) and stored as
``fernet:v1:<fernet token>``. The version tag lets readers tell ciphertext
from legacy plaintext rows written before migration 013, and leaves room for a
later scheme (for example ``kms:v2:`` envelope encryption).

Keys come from ``TOKEN_ENCRYPTION_KEYS``: a comma-separated list of Fernet
keys. The first key encrypts; every key decrypts (``MultiFernet``), so a key
can be rotated without downtime:

1. Prepend a new key: ``NEW,OLD``. Deploy. New writes use NEW, old rows still
   decrypt with OLD.
2. Run ``python -m app.scripts.reencrypt_tokens`` (as the schema owner) to
   re-encrypt every row under NEW.
3. Drop OLD from the list. Deploy.

On Cloud Run the value is a Secret Manager secret (``token-encryption-keys``),
mounted with ``--set-secrets`` exactly like ``RUN_HMAC_SECRET``.

TODO(kms): replace the Secret-Manager-held key with envelope encryption: keep a
Cloud KMS-wrapped data key in the secret, unwrap it once at startup with
``kms.decrypt`` (the run SA gets ``roles/cloudkms.cryptoKeyDecrypter`` only),
and tag those rows ``kms:v2:``. ``load_keys`` is the single seam to change.

Fail closed: outside ``AUTH_MODE=dev`` a missing or invalid key raises
:class:`TokenEncryptionNotConfigured`. In dev mode an ephemeral key is
generated with a warning; anything it encrypted is unreadable after restart.
"""

from __future__ import annotations

import functools
import logging

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

log = logging.getLogger(__name__)

PREFIX = "fernet:v1:"


class TokenEncryptionNotConfigured(RuntimeError):
    """``TOKEN_ENCRYPTION_KEYS`` is missing or invalid outside dev mode."""


class TokenDecryptError(ValueError):
    """A stored value could not be decrypted with any configured key."""


def is_encrypted(stored: str) -> bool:
    """True if ``stored`` carries a known ciphertext version tag."""
    return stored.startswith(PREFIX)


def parse_keys(raw: str | None) -> list[bytes]:
    """Splits ``TOKEN_ENCRYPTION_KEYS`` and validates each key.

    Raises ``ValueError`` naming the bad key's *position*, never its value.
    """
    keys = [k.strip().encode() for k in (raw or "").split(",") if k.strip()]
    for i, k in enumerate(keys):
        try:
            Fernet(k)
        except Exception as exc:
            raise ValueError(
                f"TOKEN_ENCRYPTION_KEYS entry #{i + 1} is not a valid Fernet key "
                "(32 url-safe base64-encoded bytes)."
            ) from exc
    return keys


class TokenCipher:
    """Encrypts with the primary key, decrypts with any configured key."""

    def __init__(self, keys: list[bytes]) -> None:
        if not keys:
            raise ValueError("TokenCipher needs at least one key.")
        self._primary = Fernet(keys[0])
        self._all = MultiFernet([Fernet(k) for k in keys])

    def encrypt(self, plaintext: str) -> str:
        """Returns ``fernet:v1:<ciphertext>`` under the primary key."""
        return PREFIX + self._all.encrypt(plaintext.encode()).decode()

    def decrypt(self, stored: str, *, allow_plaintext: bool = False) -> str:
        """Returns the plaintext of a stored value.

        A legacy untagged value is returned as-is only with
        ``allow_plaintext=True``; otherwise it raises ``TokenDecryptError``.
        """
        if not is_encrypted(stored):
            if allow_plaintext:
                return stored
            raise TokenDecryptError("value is not encrypted (legacy plaintext)")
        try:
            return self._all.decrypt(stored[len(PREFIX) :].encode()).decode()
        except InvalidToken as exc:
            raise TokenDecryptError(
                "value was encrypted with a key that is no longer configured"
            ) from exc

    def needs_reencrypt(self, stored: str) -> bool:
        """True for legacy plaintext or ciphertext not under the primary key."""
        if not is_encrypted(stored):
            return True
        try:
            self._primary.decrypt(stored[len(PREFIX) :].encode())
            return False
        except InvalidToken:
            return True

    def reencrypt(self, stored: str) -> str:
        """Returns ``stored`` encrypted under the primary key (idempotent in effect)."""
        if not is_encrypted(stored):
            return self.encrypt(stored)
        try:
            rotated = self._all.rotate(stored[len(PREFIX) :].encode())
        except InvalidToken as exc:
            raise TokenDecryptError(
                "value was encrypted with a key that is no longer configured"
            ) from exc
        return PREFIX + rotated.decode()


def load_keys() -> list[bytes]:
    """Resolves the key list from settings; the KMS seam (see module doc)."""
    from app.config import get_settings

    s = get_settings()
    try:
        keys = parse_keys(s.token_encryption_keys)
    except ValueError as exc:
        raise TokenEncryptionNotConfigured(str(exc)) from exc
    if keys:
        return keys
    if s.auth_mode == "dev":
        log.warning(
            "TOKEN_ENCRYPTION_KEYS is not set; using an ephemeral key (dev only). "
            "Stored GitHub tokens will be unreadable after a restart."
        )
        return [Fernet.generate_key()]
    raise TokenEncryptionNotConfigured(
        "TOKEN_ENCRYPTION_KEYS must be set outside AUTH_MODE=dev "
        "(Secret Manager secret token-encryption-keys on Cloud Run)."
    )


@functools.cache
def get_cipher() -> TokenCipher:
    """The process-wide cipher. Call ``get_cipher.cache_clear()`` after changing keys."""
    return TokenCipher(load_keys())
