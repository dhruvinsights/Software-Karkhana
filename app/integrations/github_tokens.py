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

"""The only code that reads or writes ``github_tokens``.

Tokens are encrypted on write and decrypted on read with :mod:`app.crypto`.
Plaintext never leaves this module except to the caller that needs it for a
GitHub API call; it is never logged, returned by an API, or put in a worker's
environment.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto import TokenDecryptError, get_cipher, is_encrypted
from app.models import GitHubToken

log = logging.getLogger(__name__)

DEFAULT_SCOPES = "repo,workflow,read:org"


async def save_token(
    session: AsyncSession,
    user_id: uuid.UUID,
    token: str,
    scopes: str = DEFAULT_SCOPES,
) -> None:
    """Stores (or replaces) the user's token, encrypted under the primary key."""
    ciphertext = get_cipher().encrypt(token)
    stmt = insert(GitHubToken).values(
        id=uuid.uuid4(), user_id=user_id, token=ciphertext, scopes=scopes
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[GitHubToken.user_id],
        set_={
            "token": ciphertext,
            "scopes": scopes,
            "updated_at": dt.datetime.now(dt.UTC),
        },
    )
    await session.execute(stmt)


async def load_token(session: AsyncSession, user_id: uuid.UUID) -> str | None:
    """Returns the user's plaintext token, or None if absent or unreadable.

    A legacy plaintext row is still usable (with a warning) until
    ``app.scripts.reencrypt_tokens`` has run. A row encrypted under a key that
    is no longer configured is treated as absent: the user reconnects.
    """
    stored = await session.scalar(
        select(GitHubToken.token).where(GitHubToken.user_id == user_id)
    )
    if stored is None:
        return None
    if not is_encrypted(stored):
        log.warning(
            "github_tokens row for user %s is legacy plaintext; run "
            "python -m app.scripts.reencrypt_tokens",
            user_id,
        )
    try:
        return get_cipher().decrypt(stored, allow_plaintext=True)
    except TokenDecryptError:
        log.error("github_tokens row for user %s cannot be decrypted", user_id)
        return None


async def token_info(session: AsyncSession, user_id: uuid.UUID) -> GitHubToken | None:
    """Row metadata for status displays. Callers must not expose ``.token``."""
    return await session.scalar(
        select(GitHubToken).where(GitHubToken.user_id == user_id)
    )


async def delete_token(session: AsyncSession, user_id: uuid.UUID) -> bool:
    """Removes the user's token. Returns True if one existed."""
    result = await session.execute(
        delete(GitHubToken).where(GitHubToken.user_id == user_id)
    )
    return bool(result.rowcount)
