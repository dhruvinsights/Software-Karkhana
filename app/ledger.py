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
"""Evidence ledger: append-only SHA-256 hash chains in Cloud SQL, one per tenant.

Each entry's hash covers the previous entry's hash and a canonical JSON body,
so changing or removing any row breaks every later link. Every workspace has
its own chain (``chain = str(workspace_id)``); rows with no workspace go to the
``platform`` chain, and rows written before migration 014 stay in the frozen
``legacy`` chain, which still verifies exactly as before.

Appends take a transaction-scoped advisory lock *per chain*, so each chain
stays linear under concurrent Cloud Run instances without one tenant's writes
serialising another's. The database role and a trigger make the table
append-only; this module makes tampering *detectable*.

A chain stored in the database it protects proves detection, not prevention:
a database owner could rewrite a whole chain consistently. So the chain head is
also *anchored* outside the database (every ``LEDGER_ANCHOR_EVERY`` entries and
on demand) to a retention-locked Cloud Storage bucket, or a local JSONL file in
development. ``verify_chain(..., anchors=load_anchors(chain))`` then also checks
the stored hashes against those anchors, which catches a consistent rewrite and
a truncated tail.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import functools
import hashlib
import json
import logging
import threading
import uuid
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import event, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Idea, LedgerEntry, Product, Project, User

logger = logging.getLogger(__name__)

GENESIS_HASH = "0" * 64
_LOCK_KEY = 0x4B41524B  # "KARK": first half of the per-chain advisory lock key.
LEGACY_CHAIN = "legacy"  # Rows written before migration 014: one global chain.
PLATFORM_CHAIN = "platform"  # Rows that belong to no workspace.


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


def chain_for(workspace_id: uuid.UUID | None) -> str:
    """The chain name for a workspace (``platform`` when there is none)."""
    return str(workspace_id) if workspace_id else PLATFORM_CHAIN


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
    chain: str | None = None,
    chain_seq: int | None = None,
) -> bytes:
    """Serializes the hashed fields deterministically.

    Rows in a per-tenant chain also hash their chain and position, so a row
    cannot be moved to another tenant's chain. Legacy rows (``chain=None``)
    keep the original body so their stored hashes stay valid.
    """
    body: dict[str, Any] = {
        "project_id": project_id,
        "actor": actor_label,
        "actor_kind": actor_kind,
        "action": action,
        "subject": f"{subject_type}:{subject_id}",
        "payload": payload,
        "at": created_at.astimezone(dt.UTC).isoformat(timespec="microseconds"),
    }
    if chain is not None:
        body["chain"] = chain
        body["chain_seq"] = chain_seq
    return json.dumps(body, sort_keys=True, separators=(",", ":"), default=str).encode()


def link_hash(prev_hash: str, body: bytes) -> str:
    """Returns sha256(prev_hash || body) as hex."""
    return hashlib.sha256(prev_hash.encode() + body).hexdigest()


def _as_uuid(value: Any) -> uuid.UUID | None:
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


async def _resolve_workspace(
    session: AsyncSession,
    *,
    project_id: uuid.UUID | None,
    subject_type: str,
    subject_id: str,
) -> uuid.UUID | None:
    """Infers the tenant of an entry from its project or its subject."""
    if project_id is not None:
        return await session.scalar(
            select(Project.workspace_id).where(Project.id == project_id)
        )
    sid = _as_uuid(subject_id)
    if sid is None:
        return None
    if subject_type == "workspace":
        return sid
    model = {"idea": Idea, "product": Product, "project": Project}.get(subject_type)
    if model is None:
        return None
    return await session.scalar(select(model.workspace_id).where(model.id == sid))


_UNSET: Any = object()


async def append(
    session: AsyncSession,
    *,
    actor: Actor,
    action: str,
    subject_type: str,
    subject_id: str | uuid.UUID,
    project_id: uuid.UUID | None = None,
    payload: dict[str, Any] | None = None,
    workspace_id: uuid.UUID | None = _UNSET,
) -> LedgerEntry:
    """Appends one entry to its tenant's chain inside the caller's transaction.

    Args:
        session: The open transaction. The entry commits with the business
            change it records, or not at all.
        actor: Who acted.
        action: Dotted event name, e.g. ``project.approved``.
        subject_type: Kind of record acted on, e.g. ``project``.
        subject_id: Identifier of that record.
        project_id: Project scope for filtering, if any.
        payload: Small JSON facts worth proving later.
        workspace_id: The tenant chain to write to. When omitted it is taken
            from the project, or from a workspace/idea/product subject; pass
            ``None`` explicitly for a platform event.

    Returns:
        The new ledger row.
    """
    payload = json.loads(json.dumps(payload or {}, default=str))
    if workspace_id is _UNSET:
        workspace_id = await _resolve_workspace(
            session,
            project_id=project_id,
            subject_type=subject_type,
            subject_id=str(subject_id),
        )
    chain = chain_for(workspace_id)
    # Two-key lock: one lock per chain; tenants never wait on each other.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(CAST(:k AS integer), hashtext(:c))"),
        {"k": _LOCK_KEY, "c": chain},
    )
    prev = await session.scalar(
        select(LedgerEntry)
        .where(LedgerEntry.chain == chain)
        .order_by(LedgerEntry.seq.desc())
        .limit(1)
    )
    prev_hash = prev.hash if prev else GENESIS_HASH
    chain_seq = (prev.chain_seq or 0) + 1 if prev else 1
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
        chain=chain,
        chain_seq=chain_seq,
    )
    entry = LedgerEntry(
        project_id=project_id,
        workspace_id=workspace_id,
        chain=chain,
        chain_seq=chain_seq,
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
    every = get_settings().ledger_anchor_every
    if every > 0 and chain_seq % every == 0:
        _queue_anchor(session, Anchor.of(entry, reason="auto"))
    return entry


async def append_entry(
    session: AsyncSession,
    *,
    action: str,
    actor: Actor | str,
    payload: dict[str, Any] | None = None,
    subject_type: str = "user",
    subject_id: str | uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = _UNSET,
) -> LedgerEntry:
    """Compatibility wrapper for callers that pass the actor as a plain label.

    ``app.routers.auth`` records OAuth sign-ups this way; those are platform
    events (no workspace yet).
    """
    if isinstance(actor, str):
        actor = Actor(label=actor, kind="human")
    payload = payload or {}
    if subject_id is None:
        subject_id = str(payload.get("user_id") or actor.label)
    if workspace_id is _UNSET and project_id is None and subject_type == "user":
        workspace_id = None
    return await append(
        session,
        actor=actor,
        action=action,
        subject_type=subject_type,
        subject_id=subject_id,
        project_id=project_id,
        payload=payload,
        workspace_id=workspace_id,
    )


# ── Verification ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ChainReport:
    """Result of verifying one chain."""

    ok: bool
    entries: int
    head: str
    first_bad_seq: int | None = None
    reason: str | None = None
    chain: str = LEGACY_CHAIN
    anchors_checked: int = 0


def _position(entry_chain_seq: int | None, seq: int) -> int:
    """Where an anchor points: chain_seq in tenant chains, global seq in legacy."""
    return entry_chain_seq if entry_chain_seq is not None else seq


async def verify_chain(
    session: AsyncSession,
    chain: str,
    *,
    anchors: Iterable[dict[str, Any]] | None = None,
) -> ChainReport:
    """Recomputes one chain from genesis and reports the first break.

    Args:
        session: Any session (read only).
        chain: ``str(workspace_id)``, ``"platform"`` or ``"legacy"``.
        anchors: Optional external anchor records for this chain
            (:func:`load_anchors`). Each anchored position must still hold the
            anchored hash, and the chain must reach the last anchored position.
    """
    want = {
        int(a["position"]): a["hash"]
        for a in (anchors or [])
        if a.get("chain") == chain and a.get("position") is not None
    }
    checked = 0
    prev = GENESIS_HASH
    count = 0
    last_pos = 0
    ws = _as_uuid(chain)
    result = await session.stream_scalars(
        select(LedgerEntry).where(LedgerEntry.chain == chain).order_by(LedgerEntry.seq)
    )

    def bad(e: LedgerEntry, why: str) -> ChainReport:
        return ChainReport(False, count, prev, e.seq, why, chain, checked)

    async for e in result:
        count += 1
        if e.prev_hash != prev:
            return bad(e, "prev_hash does not match")
        legacy = chain == LEGACY_CHAIN
        if not legacy:
            if e.chain_seq != count:
                return bad(e, "chain position out of order")
            if (ws is None and e.workspace_id is not None) or (
                ws is not None and e.workspace_id != ws
            ):
                return bad(e, "workspace does not match chain")
        body = canonical_body(
            project_id=str(e.project_id) if e.project_id else None,
            actor_label=e.actor_label,
            actor_kind=e.actor_kind,
            action=e.action,
            subject_type=e.subject_type,
            subject_id=e.subject_id,
            payload=e.payload,
            created_at=e.created_at,
            chain=None if legacy else chain,
            chain_seq=None if legacy else e.chain_seq,
        )
        if link_hash(prev, body) != e.hash:
            return bad(e, "content was altered")
        last_pos = _position(None if legacy else e.chain_seq, e.seq)
        if last_pos in want:
            checked += 1
            if want[last_pos] != e.hash:
                return bad(e, "hash differs from external anchor")
        prev = e.hash
    if want and max(want) > last_pos:
        return ChainReport(
            False, count, prev, None, "anchored entries are missing", chain, checked
        )
    return ChainReport(True, count, prev, chain=chain, anchors_checked=checked)


# ── External anchors ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Anchor:
    """A chain head, written outside the database."""

    chain: str
    workspace_id: str | None
    position: int  # chain_seq (tenant chains) or seq (legacy chain)
    seq: int
    hash: str
    entry_at: str
    anchored_at: str
    reason: str  # "auto" | "manual"

    @classmethod
    def of(cls, e: LedgerEntry, *, reason: str) -> Anchor:
        """Builds the anchor record for one committed entry."""
        return cls(
            chain=e.chain,
            workspace_id=str(e.workspace_id) if e.workspace_id else None,
            position=_position(e.chain_seq, e.seq),
            seq=e.seq,
            hash=e.hash,
            entry_at=e.created_at.astimezone(dt.UTC).isoformat(),
            anchored_at=dt.datetime.now(dt.UTC).isoformat(timespec="microseconds"),
            reason=reason,
        )


@dataclass
class AnchorResult:
    """What happened to one anchor write. Never raised; always returned."""

    ok: bool
    sink: str  # "gcs" | "file"
    location: str | None
    anchor: Anchor
    error: str | None = None
    record: dict[str, Any] = field(default_factory=dict)


_file_lock = threading.Lock()
_pending_key = "karkhana_ledger_pending_anchors"
_hooked_key = "karkhana_ledger_anchor_hooked"
_tasks: set[asyncio.Task] = set()


@functools.cache
def _gcs_client():
    from google.cloud import storage

    return storage.Client()


def _write_file(path: str, record: dict[str, Any]) -> str:
    p = Path(path)
    if p.parent and not p.parent.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, sort_keys=True) + "\n"
    with _file_lock, p.open("a", encoding="utf-8") as fh:
        fh.write(line)
        fh.flush()
    return str(p)


def _write_gcs(bucket: str, prefix: str, anchor: Anchor) -> str:
    stamp = anchor.anchored_at.replace(":", "").replace("-", "").replace("+0000", "Z")
    name = f"{prefix}/{anchor.chain}/{anchor.position:012d}-{stamp}.json"
    blob = _gcs_client().bucket(bucket).blob(name)
    # if_generation_match=0: create only, never overwrite.
    blob.upload_from_string(
        json.dumps(asdict(anchor), sort_keys=True),
        content_type="application/json",
        if_generation_match=0,
    )
    return f"gs://{bucket}/{name}"


def write_anchor(anchor: Anchor) -> AnchorResult:
    """Writes one anchor to the configured sink. Logs and returns on failure."""
    s = get_settings()
    record = asdict(anchor)
    # The structured log line is itself a second, independent copy of the head
    # (Cloud Logging on Cloud Run).
    logger.info("ledger.anchor %s", json.dumps(record, sort_keys=True))
    if s.ledger_anchor_bucket:
        try:
            loc = _write_gcs(s.ledger_anchor_bucket, s.ledger_anchor_prefix, anchor)
            return AnchorResult(True, "gcs", loc, anchor, record=record)
        except Exception as exc:
            logger.exception("Ledger anchor to gs://%s failed", s.ledger_anchor_bucket)
            failed = {**record, "status": "sink_failed", "error": str(exc)[:500]}
            try:
                _write_file(s.ledger_anchor_path, failed)
            except Exception:
                logger.exception("Could not record the failed anchor locally")
            return AnchorResult(False, "gcs", None, anchor, str(exc)[:500], record)
    try:
        loc = _write_file(s.ledger_anchor_path, {**record, "status": "ok"})
        return AnchorResult(True, "file", loc, anchor, record=record)
    except Exception as exc:
        logger.exception("Ledger anchor to %s failed", s.ledger_anchor_path)
        return AnchorResult(False, "file", None, anchor, str(exc)[:500], record)


def _dispatch(anchor: Anchor) -> None:
    if not get_settings().ledger_anchor_bucket:
        write_anchor(anchor)  # A local append is fast enough to do inline.
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        write_anchor(anchor)
        return
    task = loop.create_task(asyncio.to_thread(write_anchor, anchor))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def _after_commit(sync_session) -> None:
    for anchor in sync_session.info.pop(_pending_key, []):
        try:
            _dispatch(anchor)
        except Exception:
            logger.exception("Ledger anchor dispatch failed")


def _after_rollback(sync_session) -> None:
    sync_session.info.pop(_pending_key, None)


def _queue_anchor(session: AsyncSession, anchor: Anchor) -> None:
    """Writes the anchor only once the entry is committed (never a phantom head)."""
    sync = session.sync_session
    sync.info.setdefault(_pending_key, []).append(anchor)
    if not sync.info.get(_hooked_key):
        event.listen(sync, "after_commit", _after_commit)
        event.listen(sync, "after_rollback", _after_rollback)
        sync.info[_hooked_key] = True


async def drain_anchors() -> None:
    """Waits for background anchor uploads (tests and graceful shutdown)."""
    if _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


async def anchor_head(
    session: AsyncSession, chain: str, *, reason: str = "manual"
) -> AnchorResult | None:
    """Anchors the current committed head of ``chain`` now. ``None`` if empty."""
    head = await session.scalar(
        select(LedgerEntry)
        .where(LedgerEntry.chain == chain)
        .order_by(LedgerEntry.seq.desc())
        .limit(1)
    )
    if head is None:
        return None
    return await asyncio.to_thread(write_anchor, Anchor.of(head, reason=reason))


def load_anchors(chain: str) -> list[dict[str, Any]]:
    """Reads the successful anchors recorded for ``chain`` from the sink."""
    s = get_settings()
    out: list[dict[str, Any]] = []
    if s.ledger_anchor_bucket:
        bucket = _gcs_client().bucket(s.ledger_anchor_bucket)
        for blob in bucket.list_blobs(prefix=f"{s.ledger_anchor_prefix}/{chain}/"):
            out.append(json.loads(blob.download_as_bytes()))
        return out
    p = Path(s.ledger_anchor_path)
    if not p.exists():
        return out
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if rec.get("chain") == chain and rec.get("status", "ok") == "ok":
            out.append(rec)
    return out
