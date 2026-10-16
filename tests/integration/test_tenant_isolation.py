# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Tenant isolation of memory, ledger and learnings; per-tenant chains; anchors."""

from __future__ import annotations

import json
import uuid

import asyncpg
import pytest
from sqlalchemy import select, update

from app import db, ledger, memory
from app.config import get_settings
from app.models import Learning, LedgerEntry, User
from tests.fakes import fake_vector
from tests.integration.test_golden_path import (  # noqa: F401
    PM,
    as_,
    client,
    fakes,
)

# Tenant B gets its own account: making a seeded demo user own a workspace
# would change that user's primary workspace (and role) for later tests.
DIR = "globex-owner@karkhana.dev"

ROUNDING = "Store money in minor units and round half-even at the edge."


@pytest.fixture(autouse=True)
async def _leave_users_not_onboarded(client):
    async with db.sessionmaker()() as s:
        if await s.scalar(select(User).where(User.email == DIR)) is None:
            s.add(User(id=uuid.uuid4(), email=DIR, display_name="Globex owner", role="developer"))
            await s.commit()
    yield
    async with db.sessionmaker()() as s:
        await s.execute(update(User).values(onboarded_at=None))
        await s.commit()


@pytest.fixture
def anchors(tmp_path, monkeypatch):
    path = tmp_path / "anchors.jsonl"
    monkeypatch.setenv("LEDGER_ANCHOR_PATH", str(path))
    monkeypatch.setenv("LEDGER_ANCHOR_EVERY", "2")
    monkeypatch.delenv("LEDGER_ANCHOR_BUCKET", raising=False)
    get_settings.cache_clear()
    yield path
    monkeypatch.undo()
    get_settings.cache_clear()


async def _tenant(client, who, name):
    """A workspace owned by ``who`` with one project and one verified learning."""
    ws = (
        await client.post(
            "/api/workspaces/create", headers=as_(who), json={"name": name}
        )
    ).json()["id"]
    r = await client.post(
        "/api/projects",
        headers=as_(who),
        json={
            "name": f"{name} payments",
            "idea_text": "Round money",
            "workspace_id": ws,
        },
    )
    assert r.status_code == 202, r.text
    pid = r.json()["id"]
    async with db.sessionmaker()() as s:
        lr = Learning(
            id=uuid.uuid4(),
            project_id=uuid.UUID(pid),
            text=f"{name}: {ROUNDING}",
            status="verified",
            embedding=fake_vector(ROUNDING),
            embedding_model=memory.llm.embed_model_name(),
            source={},
        )
        s.add(lr)
        await s.commit()
    return uuid.UUID(ws), pid, str(lr.id)


async def test_memory_ledger_and_learnings_never_cross_tenants(client):
    ws_a, pid_a, lr_a = await _tenant(client, PM, "Acme")
    ws_b, pid_b, lr_b = await _tenant(client, DIR, "Globex")

    # Memory retrieval only offers the evaluated project's own workspace.
    async with db.sessionmaker()() as s:
        hits_a = await memory.retrieve(
            s, ROUNDING, project_id=uuid.UUID(pid_a), workspace_id=ws_a
        )
        hits_b = await memory.retrieve(
            s, ROUNDING, project_id=uuid.UUID(pid_b), workspace_id=ws_b
        )
    assert {str(h[0].id) for h in hits_a} == {lr_a}
    assert {str(h[0].id) for h in hits_b} == {lr_b}
    assert all(name == "Acme payments" for _, name, _ in hits_a)

    # /api/learnings: only learnings of projects the caller may see.
    mine = {
        r["id"] for r in (await client.get("/api/learnings", headers=as_(DIR))).json()
    }
    assert lr_b in mine and lr_a not in mine
    # A director elsewhere cannot verify another tenant's learning (404: not even its existence).
    r = await client.post(f"/api/learnings/{lr_a}/verify", headers=as_(DIR))
    assert r.status_code == 404

    # /api/ledger: no entries of the other tenant, and project_id is access-checked.
    async with db.sessionmaker()() as s:
        a_seqs = set(
            (
                await s.scalars(
                    select(LedgerEntry.seq).where(LedgerEntry.workspace_id == ws_a)
                )
            ).all()
        )
    assert a_seqs
    seen = {
        e["seq"]
        for e in (await client.get("/api/ledger?limit=500", headers=as_(DIR))).json()
    }
    assert not seen & a_seqs
    assert (
        await client.get(f"/api/ledger?project_id={pid_a}", headers=as_(DIR))
    ).status_code == 403
    own = (await client.get(f"/api/ledger?project_id={pid_a}", headers=as_(PM))).json()
    assert own and all(e["seq"] in a_seqs for e in own)

    # Verification: members only, and only their own chains.
    assert (
        await client.get(f"/api/ledger/verify?workspace_id={ws_a}", headers=as_(DIR))
    ).status_code == 403
    v = (
        await client.get(f"/api/ledger/verify?workspace_id={ws_a}", headers=as_(PM))
    ).json()
    assert v["ok"] and [c["chain"] for c in v["chains"]] == [str(ws_a)]
    assert v["entries"] == len(a_seqs)
    allmine = (await client.get("/api/ledger/verify", headers=as_(DIR))).json()
    assert allmine["ok"] and str(ws_a) not in {c["chain"] for c in allmine["chains"]}


async def test_each_workspace_has_its_own_chain_and_tamper_breaks_only_it(
    client, database
):
    ws_a, _, _ = await _tenant(client, PM, "Initech")
    ws_b, _, _ = await _tenant(client, DIR, "Hooli")
    async with db.sessionmaker()() as s:
        rows_a = (
            await s.scalars(
                select(LedgerEntry)
                .where(LedgerEntry.chain == str(ws_a))
                .order_by(LedgerEntry.seq)
            )
        ).all()
        assert rows_a[0].prev_hash == ledger.GENESIS_HASH
        assert [r.chain_seq for r in rows_a] == list(range(1, len(rows_a) + 1))
        assert (await ledger.verify_chain(s, str(ws_a))).ok
        assert (await ledger.verify_chain(s, str(ws_b))).ok

    target = rows_a[0]
    conn = await asyncpg.connect(database.replace("+asyncpg", ""))
    try:
        await conn.execute("ALTER TABLE ledger DISABLE TRIGGER ledger_no_update_delete")
        await conn.execute(
            "UPDATE ledger SET payload = payload || '{\"forged\": true}' WHERE seq = $1",
            target.seq,
        )
        async with db.sessionmaker()() as s:
            bad = await ledger.verify_chain(s, str(ws_a))
            assert not bad.ok and bad.first_bad_seq == target.seq
            assert bad.reason == "content was altered"
            assert (await ledger.verify_chain(s, str(ws_b))).ok
        r = (
            await client.get(
                f"/api/ledger/verify?workspace_id={ws_b}", headers=as_(DIR)
            )
        ).json()
        assert r["ok"]
        r = (
            await client.get(f"/api/ledger/verify?workspace_id={ws_a}", headers=as_(PM))
        ).json()
        assert not r["ok"] and r["first_bad_seq"] == target.seq
    finally:
        await conn.execute(
            "UPDATE ledger SET payload = $2::jsonb WHERE seq = $1",
            target.seq,
            json.dumps(target.payload),
        )
        await conn.execute("ALTER TABLE ledger ENABLE TRIGGER ledger_no_update_delete")
        await conn.close()
    async with db.sessionmaker()() as s:
        assert (await ledger.verify_chain(s, str(ws_a))).ok


async def test_anchors_are_written_and_checked(client, anchors, monkeypatch):
    ws, pid, _ = await _tenant(client, PM, "Umbrella")
    chain = str(ws)
    # Auto anchors every 2 entries, written only after commit.
    async with db.sessionmaker()() as s:
        for i in range(4):
            await ledger.append(
                s,
                actor=ledger.SYSTEM,
                action="test.tick",
                subject_type="project",
                subject_id=pid,
                project_id=uuid.UUID(pid),
                payload={"i": i},
            )
        await s.rollback()  # Rolled back: no phantom anchors.
    before = ledger.load_anchors(chain)
    async with db.sessionmaker()() as s:
        for i in range(4):
            await ledger.append(
                s,
                actor=ledger.SYSTEM,
                action="test.tick",
                subject_type="project",
                subject_id=pid,
                project_id=uuid.UUID(pid),
                payload={"i": i},
            )
        await s.commit()
    auto = ledger.load_anchors(chain)
    assert len(auto) - len(before) == 2
    assert all(a["position"] % 2 == 0 and a["reason"] == "auto" for a in auto)

    # Manual anchor: members only.
    assert (
        await client.post(f"/api/ledger/anchor?workspace_id={ws}", headers=as_(DIR))
    ).status_code == 403
    r = (
        await client.post(f"/api/ledger/anchor?workspace_id={ws}", headers=as_(PM))
    ).json()
    assert r["ok"] and r["sink"] == "file" and r["chain"] == chain
    recs = [json.loads(line) for line in anchors.read_text().splitlines()]
    assert recs[-1]["hash"] == r["hash"] and recs[-1]["reason"] == "manual"

    async with db.sessionmaker()() as s:
        ok = await ledger.verify_chain(s, chain, anchors=ledger.load_anchors(chain))
        assert ok.ok and ok.anchors_checked >= 3
        # A consistent rewrite (different hash at an anchored position) is caught...
        forged = [{**auto[0], "hash": "f" * 64}]
        assert (await ledger.verify_chain(s, chain, anchors=forged)).reason == (
            "hash differs from external anchor"
        )
        # ...and so is a truncated tail.
        beyond = [{**auto[-1], "position": 10_000}]
        assert (await ledger.verify_chain(s, chain, anchors=beyond)).reason == (
            "anchored entries are missing"
        )

    # A failing sink never breaks the request; the failure is recorded locally.
    monkeypatch.setenv("LEDGER_ANCHOR_BUCKET", "no-such-bucket")
    get_settings.cache_clear()

    def boom(*a, **k):
        raise RuntimeError("bucket unavailable")

    monkeypatch.setattr(ledger, "_write_gcs", boom)
    r = await client.post(f"/api/ledger/anchor?workspace_id={ws}", headers=as_(PM))
    assert r.status_code == 200 and r.json()["ok"] is False
    assert "bucket unavailable" in r.json()["error"]
    assert json.loads(anchors.read_text().splitlines()[-1])["status"] == "sink_failed"
