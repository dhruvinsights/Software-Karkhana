# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Ledger tamper detection and concurrent-append integrity.

An attacker with the schema owner's credentials disables the append-only
trigger, then edits, deletes, reorders, moves, back-dates, truncates or fully
re-hashes ledger rows. Each attack runs in its own transaction that is rolled
back, and ``ledger.verify_chain`` must report the break.

Two configurations are measured:
- hash chain alone (no external anchor), and
- hash chain plus the external head anchor (production: Cloud Storage bucket
  with a retention policy, written by the anchor job).
"""

from __future__ import annotations

import asyncio
import random
import time
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app import ledger
from tests.bench.conftest import record

pytestmark = pytest.mark.usefixtures("database")

CHAIN_LEN = 200
TRIALS_PER_ATTACK = 50
CONCURRENT_APPENDS = 100


async def _seed_chain(n: int) -> uuid.UUID:
    from app.db import sessionmaker

    ws = uuid.uuid4()
    async with sessionmaker()() as s:
        for i in range(n):
            await ledger.append(
                s,
                actor=ledger.Actor(label=f"user{i % 7}@bench", kind="human"),
                action=random.choice(["stage.approve", "run.completed", "finding.triaged", "qa.signoff"]),
                subject_type="bench",
                subject_id=str(i),
                payload={"i": i, "note": f"entry {i}"},
                workspace_id=ws,
            )
        await s.commit()
    return ws


async def _rows(conn, chain: str) -> list:
    return (
        await conn.execute(
            text("SELECT seq, chain_seq FROM ledger WHERE chain=:c ORDER BY seq"), {"c": chain}
        )
    ).all()


async def _rehash_from(conn, chain: str, start_seq: int) -> None:
    """Attacker recomputes every hash from ``start_seq`` so the chain links again."""
    rows = (
        await conn.execute(
            text(
                "SELECT seq, project_id, actor_label, actor_kind, action, subject_type, subject_id,"
                " payload, created_at, chain_seq, prev_hash FROM ledger WHERE chain=:c ORDER BY seq"
            ),
            {"c": chain},
        )
    ).all()
    prev = None
    for r in rows:
        if r.seq < start_seq:
            prev = (await conn.execute(text("SELECT hash FROM ledger WHERE seq=:s"), {"s": r.seq})).scalar()
            continue
        prev = prev or ledger.GENESIS_HASH
        body = ledger.canonical_body(
            project_id=str(r.project_id) if r.project_id else None,
            actor_label=r.actor_label,
            actor_kind=r.actor_kind,
            action=r.action,
            subject_type=r.subject_type,
            subject_id=r.subject_id,
            payload=r.payload,
            created_at=r.created_at,
            chain=chain,
            chain_seq=r.chain_seq,
        )
        new = ledger.link_hash(prev, body)
        await conn.execute(
            text("UPDATE ledger SET prev_hash=:p, hash=:h WHERE seq=:s"), {"p": prev, "h": new, "s": r.seq}
        )
        prev = new


async def _attack(conn, kind: str, chain: str, rng: random.Random) -> None:
    rows = await _rows(conn, chain)
    seqs = [r.seq for r in rows]
    s = rng.choice(seqs)
    q = lambda sql, **p: conn.execute(text(sql), p)  # noqa: E731
    if kind == "edit_payload":
        await q("UPDATE ledger SET payload = payload || '{\"tampered\": true}'::jsonb WHERE seq=:s", s=s)
    elif kind == "edit_actor":
        await q("UPDATE ledger SET actor_label='mallory@evil' WHERE seq=:s", s=s)
    elif kind == "edit_action":
        await q("UPDATE ledger SET action='stage.forged' WHERE seq=:s", s=s)
    elif kind == "edit_timestamp":
        await q("UPDATE ledger SET created_at = created_at - interval '1 hour' WHERE seq=:s", s=s)
    elif kind == "edit_actor_kind":
        await q("UPDATE ledger SET actor_kind='ai' WHERE seq=:s", s=s)
    elif kind == "delete_row":
        await q("DELETE FROM ledger WHERE seq=:s", s=s)
    elif kind == "reorder_rows":
        i = seqs.index(s)
        other = seqs[i + 1] if i + 1 < len(seqs) else seqs[i - 1]
        await q("UPDATE ledger SET seq = -1 WHERE seq=:a", a=s)
        await q("UPDATE ledger SET seq = :a WHERE seq=:b", a=s, b=other)
        await q("UPDATE ledger SET seq = :b WHERE seq=-1", b=other)
    elif kind == "move_to_other_tenant":
        other = uuid.uuid4()
        await q("UPDATE ledger SET chain=:c, workspace_id=:w WHERE seq=:s", c=str(other), w=other, s=s)
    elif kind == "backdated_insert":
        # The unique (chain, chain_seq) index already refuses this; assume the
        # attacker drops it too, so the hash chain is what has to catch it.
        await q("DROP INDEX ledger_chain_position")
        await q(
            "INSERT INTO ledger (actor_label, actor_kind, action, subject_type, subject_id, payload,"
            " created_at, prev_hash, hash, chain, chain_seq, workspace_id)"
            " SELECT 'mallory@evil','human','stage.approve','bench','x','{}'::jsonb, created_at,"
            " prev_hash, md5(random()::text), chain, chain_seq, workspace_id FROM ledger WHERE seq=:s",
            s=s,
        )
    elif kind == "truncate_tail":
        k = rng.randint(1, 10)
        await q("DELETE FROM ledger WHERE seq = ANY(:ss)", ss=seqs[-k:])
    elif kind == "edit_and_rehash":
        await q("UPDATE ledger SET payload = '{\"i\": -1}'::jsonb WHERE seq=:s", s=s)
        await _rehash_from(conn, chain, s)
    else:  # pragma: no cover
        raise AssertionError(kind)


ATTACKS = [
    "edit_payload",
    "edit_actor",
    "edit_action",
    "edit_timestamp",
    "edit_actor_kind",
    "delete_row",
    "reorder_rows",
    "move_to_other_tenant",
    "backdated_insert",
    "truncate_tail",
    "edit_and_rehash",
]


async def test_bench_ledger_tamper(database):
    ws = await _seed_chain(CHAIN_LEN)
    chain = str(ws)
    engine = create_async_engine(database)
    rng = random.Random(20261018)

    async with engine.connect() as conn:
        clean = await ledger.verify_chain(AsyncSession(bind=conn), chain)
    assert clean.ok and clean.entries == CHAIN_LEN
    head_anchor = [{"chain": chain, "position": CHAIN_LEN, "hash": clean.head}]

    per_attack: dict[str, dict[str, int]] = {}
    for kind in ATTACKS:
        caught_plain = caught_anchor = 0
        for _ in range(TRIALS_PER_ATTACK):
            async with engine.connect() as conn:
                tx = await conn.begin()
                await conn.execute(text("ALTER TABLE ledger DISABLE TRIGGER ledger_no_update_delete"))
                await _attack(conn, kind, chain, rng)
                s = AsyncSession(bind=conn)
                plain = await ledger.verify_chain(s, chain)
                anchored = await ledger.verify_chain(s, chain, anchors=head_anchor)
                await tx.rollback()
            caught_plain += not plain.ok
            caught_anchor += not anchored.ok
        per_attack[kind] = {
            "trials": TRIALS_PER_ATTACK,
            "detected_chain_only": caught_plain,
            "detected_with_anchor": caught_anchor,
        }

    # The rollbacks left the real chain untouched.
    async with engine.connect() as conn:
        assert (await ledger.verify_chain(AsyncSession(bind=conn), chain, anchors=head_anchor)).ok
    await engine.dispose()

    total = sum(v["trials"] for v in per_attack.values())
    with_anchor = sum(v["detected_with_anchor"] for v in per_attack.values())
    chain_only = sum(v["detected_chain_only"] for v in per_attack.values())
    record(
        "ledger_tamper",
        chain_length=CHAIN_LEN,
        attack_types=len(ATTACKS),
        trials=total,
        detected_with_anchor=with_anchor,
        detected_chain_only=chain_only,
        detection_rate_with_anchor=round(with_anchor / total, 4),
        detection_rate_chain_only=round(chain_only / total, 4),
        per_attack=per_attack,
    )
    assert with_anchor == total, per_attack


async def test_bench_concurrent_appends(database):
    from app.db import sessionmaker

    ws = uuid.uuid4()

    async def one(i: int) -> None:
        async with sessionmaker()() as s:
            await ledger.append(
                s,
                actor=ledger.SYSTEM,
                action="bench.concurrent",
                subject_type="bench",
                subject_id=str(i),
                payload={"i": i},
                workspace_id=ws,
            )
            await s.commit()

    t0 = time.perf_counter()
    await asyncio.gather(*(one(i) for i in range(CONCURRENT_APPENDS)))
    elapsed = time.perf_counter() - t0

    async with sessionmaker()() as s:
        report = await ledger.verify_chain(s, str(ws))
        positions = (
            await s.execute(text("SELECT chain_seq FROM ledger WHERE chain=:c ORDER BY seq"), {"c": str(ws)})
        ).scalars().all()
    record(
        "ledger_concurrency",
        concurrent_appends=CONCURRENT_APPENDS,
        chain_valid=report.ok,
        entries=report.entries,
        forks_or_gaps=int(positions != list(range(1, CONCURRENT_APPENDS + 1))),
        appends_per_second=round(CONCURRENT_APPENDS / elapsed, 1),
    )
    assert report.ok and report.entries == CONCURRENT_APPENDS
    assert positions == list(range(1, CONCURRENT_APPENDS + 1))
