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

"""Encrypts legacy plaintext GitHub tokens and re-encrypts under the primary key.

Run as the schema owner (it validates a constraint) after migration 013, and
after every key rotation (see ``app/crypto.py``). Idempotent: rows already
under the primary key are left alone. Prints counts only, never token values.

Usage:
    TOKEN_ENCRYPTION_KEYS=NEW,OLD python -m app.scripts.reencrypt_tokens [--dry-run]
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass

from sqlalchemy import text

from app import db
from app.crypto import TokenDecryptError, get_cipher, is_encrypted


@dataclass
class Report:
    """Row counts from one re-encrypt pass."""

    total: int = 0
    plaintext: int = 0
    rotated: int = 0
    unchanged: int = 0
    undecryptable: int = 0
    validated: bool = False


async def reencrypt(*, dry_run: bool = False, sessionmaker=None) -> Report:
    """Re-encrypts every row; ``sessionmaker`` defaults to ``DATABASE_URL``'s."""
    cipher = get_cipher()
    report = Report()
    async with (sessionmaker or db.sessionmaker())() as session:
        rows = (
            await session.execute(
                text("SELECT id, token FROM github_tokens ORDER BY id FOR UPDATE")
            )
        ).all()
        for row_id, stored in rows:
            report.total += 1
            if not cipher.needs_reencrypt(stored):
                report.unchanged += 1
                continue
            legacy = not is_encrypted(stored)
            try:
                new = cipher.reencrypt(stored)
            except TokenDecryptError:
                report.undecryptable += 1
                continue
            if legacy:
                report.plaintext += 1
            else:
                report.rotated += 1
            if not dry_run:
                await session.execute(
                    text(
                        "UPDATE github_tokens SET token = :t, updated_at = now() "
                        "WHERE id = :id"
                    ),
                    {"t": new, "id": row_id},
                )
        if dry_run:
            await session.rollback()
            return report
        if report.undecryptable == 0:
            # Every row is now tagged ciphertext, so the CHECK can be enforced
            # on existing rows too. Needs table ownership.
            await session.execute(
                text(
                    "ALTER TABLE github_tokens "
                    "VALIDATE CONSTRAINT github_tokens_token_encrypted"
                )
            )
            report.validated = True
        await session.commit()
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    async def run() -> Report:
        try:
            return await reencrypt(dry_run=args.dry_run)
        finally:
            await db.dispose()

    r = asyncio.run(run())
    print(
        f"github_tokens: total={r.total} plaintext_encrypted={r.plaintext} "
        f"rotated={r.rotated} unchanged={r.unchanged} "
        f"undecryptable={r.undecryptable} constraint_validated={r.validated}"
        + (" (dry run, nothing written)" if args.dry_run else "")
    )
    if r.undecryptable:
        print(
            "Some rows are encrypted under a key no longer in TOKEN_ENCRYPTION_KEYS. "
            "Add the old key back, or delete those rows so users reconnect."
        )
        raise SystemExit(1)


if __name__ == "__main__":
    main()
