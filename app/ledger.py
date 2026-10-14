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
"""Evidence ledger: an append-only SHA-256 hash chain in Cloud SQL.

Each entry's hash covers the previous entry's hash and a canonical JSON body,
so changing or removing any row breaks every later link. Appends take a
transaction-scoped advisory lock, so the chain stays linear under concurrent
Cloud Run instances. The database role and a trigger make the table
append-only; this module makes tampering *detectable*.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LedgerEntry, User

GENESIS_HASH = "0" * 64
_LOCK_KEY = 0x4B41524B  # "KARK": one global chain.


@dataclass(frozen=True)
class Actor:
    """Who performed an action: a person, an AI agent or the system."""

    label: str
    kind: str  # "human" | "ai" | "system"
    user_id: uuid.UUID | None = None

    @classmethod
    def human(cls, user: User) -> Actor:
        """Builds an actor for a signed-in person."""
        return cls(label=user.email, kind="human", user_id=user.id)

    @classmethod
    def ai(cls, agent_name: str) -> Actor:
        """Builds an actor for an AI agent."""
        return cls(label=agent_name, kind="ai")


SYSTEM = Actor(label="karkhana", kind="system")


def canonical_body(
    *,
    project_id: str | None,
    actor_label: str,
    actor_kind: str,
    action: str,
    subject_type: str,
    subject_id: str,
    payload: dict[str, Any],
    created_at: dt.datetime,
) -> bytes:
    """Serializes the hashed fields deterministically."""
    body = {
        "project_id": project_id,
        "actor": actor_label,
        "actor_kind": actor_kind,
        "action": action,
        "subject": f"{subject_type}:{subject_id}",
        "payload": payload,
        "at": created_at.astimezone(dt.UTC).isoformat(timespec="microseconds"),
    }
    return json.dumps(body, sort_keys=True, separators=(",", ":"), default=str).encode()


def link_hash(prev_hash: str, body: bytes) -> str:
    """Returns sha256(prev_hash || body) as hex."""
    return hashlib.sha256(prev_hash.encode() + body).hexdigest()


async def append(
    session: AsyncSession,
    *,
    actor: Actor,
    action: str,
    subject_type: str,
    subject_id: str | uuid.UUID,
    project_id: uuid.UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> LedgerEntry:
    """Appends one entry to the chain inside the caller's transaction.

    Args:
        session: The open transaction. The entry commits with the business
            change it records, or not at all.
        actor: Who acted.
        action: Dotted event name, e.g. ``project.approved``.
        subject_type: Kind of record acted on, e.g. ``project``.
        subject_id: Identifier of that record.
        project_id: Project scope for filtering, if any.
        payload: Small JSON facts worth proving later.

    Returns:
        The new ledger row.
    """
    payload = json.loads(json.dumps(payload or {}, default=str))
    await session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _LOCK_KEY})
    prev = await session.scalar(
        select(LedgerEntry.hash).order_by(LedgerEntry.seq.desc()).limit(1)
    )
    prev_hash = prev or GENESIS_HASH
    created_at = dt.datetime.now(dt.UTC)
    body = canonical_body(
        project_id=str(project_id) if project_id else None,
        actor_label=actor.label,
        actor_kind=actor.kind,
        action=action,
        subject_type=subject_type,
        subject_id=str(subject_id),
        payload=payload,
        created_at=created_at,
    )
    entry = LedgerEntry(
        project_id=project_id,
        actor_id=actor.user_id,
        actor_label=actor.label,
        actor_kind=actor.kind,
        action=action,
        subject_type=subject_type,
        subject_id=str(subject_id),
        payload=payload,
        created_at=created_at,
        prev_hash=prev_hash,
        hash=link_hash(prev_hash, body),
    )
    session.add(entry)
    await session.flush()
    return entry


@dataclass(frozen=True)
class ChainReport:
    """Result of verifying the whole chain."""

    ok: bool
    entries: int
    head: str
    first_bad_seq: int | None = None
    reason: str | None = None


async def verify_chain(session: AsyncSession) -> ChainReport:
    """Recomputes every link from genesis and reports the first break."""
    prev = GENESIS_HASH
    count = 0
    result = await session.stream_scalars(select(LedgerEntry).order_by(LedgerEntry.seq))
    async for e in result:
        count += 1
        if e.prev_hash != prev:
            return ChainReport(False, count, prev, e.seq, "prev_hash does not match")
        body = canonical_body(
            project_id=str(e.project_id) if e.project_id else None,
            actor_label=e.actor_label,
            actor_kind=e.actor_kind,
            action=e.action,
            subject_type=e.subject_type,
            subject_id=e.subject_id,
            payload=e.payload,
            created_at=e.created_at,
        )
        if link_hash(prev, body) != e.hash:
            return ChainReport(False, count, prev, e.seq, "content was altered")
        prev = e.hash
    return ChainReport(True, count, prev)
