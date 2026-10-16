# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""RAG on pgvector: tenant isolation and persistence, through the HTTP API."""

from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import select

from app import db
from app.ai import llm
from app.models import RagChunk, RagDocument, User, Workspace, WorkspaceMember
from tests.integration.test_golden_path import (  # noqa: F401
    DEV,
    DIR,
    PM,
    as_,
    client,
    fakes,
)

SECRET_A = "Acme refund ledger rounds every amount with ROUND_HALF_UP to paise."
SECRET_B = "Globex deploys its billing service to Cloud Run in asia-south1."


async def _workspace(name: str, *emails: str) -> str:
    """A workspace whose members are exactly ``emails`` (inserted directly)."""
    async with db.sessionmaker()() as s:
        owner = await s.scalar(select(User).where(User.email == emails[0]))
        slug = f"{name.lower()}-{uuid.uuid4().hex[:8]}"
        ws = Workspace(
            id=uuid.uuid4(), name=name, slug=slug, domain=f"{slug}.internal",
            plan="enterprise", security_posture="STANDARD", created_by=owner.id,
        )  # fmt: skip
        s.add(ws)
        await s.flush()
        for email in emails:
            u = await s.scalar(select(User).where(User.email == email))
            s.add(WorkspaceMember(workspace_id=ws.id, user_id=u.id, role="developer"))
        await s.commit()
        return str(ws.id)


@pytest.fixture
def model_calls(monkeypatch):
    """Replaces the chat model; records the context each call received."""
    calls: list[list[dict]] = []

    async def fake_generate_text(*, messages, system, kind, **_):
        calls.append(messages)
        return f"answer from {kind}"

    monkeypatch.setattr(llm, "generate_text", fake_generate_text)
    return calls


async def _ingest(client, who, ws, title, content):
    r = await client.post(
        "/api/rag/ingest",
        headers=as_(who),
        json={"workspace_id": ws, "title": title, "content": content, "tags": ["t"]},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_one_tenants_documents_never_reach_another(client, model_calls):
    ws_a = await _workspace("Acme", PM)
    ws_b = await _workspace("Globex", DEV)
    doc_a = await _ingest(client, PM, ws_a, "Acme rounding", SECRET_A)
    await _ingest(client, DEV, ws_b, "Globex deploy", SECRET_B)
    assert doc_a["chunk_count"] == 1

    # Lists are per workspace.
    a = (
        await client.get(
            "/api/rag/documents", params={"workspace_id": ws_a}, headers=as_(PM)
        )
    ).json()
    b = (
        await client.get(
            "/api/rag/documents", params={"workspace_id": ws_b}, headers=as_(DEV)
        )
    ).json()
    assert [d["title"] for d in a] == ["Acme rounding"]
    assert [d["title"] for d in b] == ["Globex deploy"]

    # A non-member cannot read, ingest into, chat with or delete from A.
    for r in (
        await client.get(
            "/api/rag/documents", params={"workspace_id": ws_a}, headers=as_(DEV)
        ),
        await client.post(
            "/api/rag/chat",
            headers=as_(DEV),
            json={"workspace_id": ws_a, "message": "refund rounding"},
        ),
        await client.post(
            "/api/rag/ingest",
            headers=as_(DEV),
            json={"workspace_id": ws_a, "title": "x", "content": "y"},
        ),
        await client.delete(
            f"/api/rag/documents/{doc_a['id']}",
            params={"workspace_id": ws_a},
            headers=as_(DEV),
        ),
    ):
        assert r.status_code == 404, r.text

    # Deleting A's document through B's workspace id does nothing.
    r = await client.delete(
        f"/api/rag/documents/{doc_a['id']}",
        params={"workspace_id": ws_b},
        headers=as_(DEV),
    )
    assert r.status_code == 404

    # B asks about A's topic: retrieval only ever sees B's chunks.
    r = await client.post(
        "/api/rag/chat",
        headers=as_(DEV),
        json={"workspace_id": ws_b, "message": "How does Acme round refund amounts?"},
    )
    assert r.status_code == 200, r.text
    assert "Acme rounding" not in r.json()["sources"]
    sent = "\n".join(m["content"] for m in model_calls[-1])
    assert "ROUND_HALF_UP" not in sent

    # A gets its own document as context.
    r = await client.post(
        "/api/rag/chat",
        headers=as_(PM),
        json={"workspace_id": ws_a, "message": "How do we round refund amounts?"},
    )
    assert r.json()["sources"] == ["Acme rounding"]
    assert "ROUND_HALF_UP" in model_calls[-1][-1]["content"]

    # Every stored chunk carries its document's workspace.
    async with db.sessionmaker()() as s:
        rows = (
            await s.execute(
                select(RagChunk.workspace_id, RagDocument.workspace_id).join(
                    RagDocument, RagDocument.id == RagChunk.document_id
                )
            )
        ).all()
    assert rows and all(c == d for c, d in rows)


async def test_history_is_private_to_user_and_workspace(client, model_calls):
    ws = await _workspace("Shared", PM, DIR)
    sid = "session-1"
    r = await client.post(
        "/api/rag/chat",
        headers=as_(PM),
        json={"workspace_id": ws, "session_id": sid, "message": "hello"},
    )
    assert r.status_code == 200 and len(r.json()["history"]) == 2
    mine = await client.get(
        f"/api/rag/history/{sid}", params={"workspace_id": ws}, headers=as_(PM)
    )
    theirs = await client.get(
        f"/api/rag/history/{sid}", params={"workspace_id": ws}, headers=as_(DIR)
    )
    assert [m["role"] for m in mine.json()] == ["user", "assistant"]
    assert theirs.json() == []

    # The second turn sends the first as history.
    await client.post(
        "/api/rag/chat",
        headers=as_(PM),
        json={"workspace_id": ws, "session_id": sid, "message": "again"},
    )
    assert [m["content"] for m in model_calls[-1][:2]] == ["hello", "answer from rag"]

    r = await client.delete(
        f"/api/rag/history/{sid}", params={"workspace_id": ws}, headers=as_(PM)
    )
    assert r.status_code == 204
    mine = await client.get(
        f"/api/rag/history/{sid}", params={"workspace_id": ws}, headers=as_(PM)
    )
    assert mine.json() == []


async def test_documents_and_history_survive_an_app_restart(client, model_calls):
    ws = await _workspace("Durable", PM)
    doc = await _ingest(
        client, PM, ws, "Runbook", "Restart the worker with make worker. " * 60
    )
    assert doc["chunk_count"] >= 2
    await client.post(
        "/api/rag/chat",
        headers=as_(PM),
        json={"workspace_id": ws, "session_id": "s", "message": "worker?"},
    )

    # A brand-new app and connection pool: nothing lives in process memory.
    from app.fast_api_app import create_app

    await db.dispose()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()), base_url="http://t"
    ) as fresh:
        docs = (
            await fresh.get(
                "/api/rag/documents", params={"workspace_id": ws}, headers=as_(PM)
            )
        ).json()
        hist = (
            await fresh.get(
                "/api/rag/history/s", params={"workspace_id": ws}, headers=as_(PM)
            )
        ).json()
        r = await fresh.post(
            "/api/rag/chat",
            headers=as_(PM),
            json={"workspace_id": ws, "message": "how do I restart the worker"},
        )
    assert [d["id"] for d in docs] == [doc["id"]] and docs[0]["chunk_count"] == doc[
        "chunk_count"
    ]
    assert [m["role"] for m in hist] == ["user", "assistant"]
    assert r.json()["sources"] == ["Runbook"]


async def test_unknown_project_is_refused(client, model_calls):
    ws = await _workspace("Projects", PM)
    r = await client.post(
        "/api/rag/ingest",
        headers=as_(PM),
        json={
            "workspace_id": ws,
            "title": "x",
            "content": "y",
            "project_id": str(uuid.uuid4()),
        },
    )
    assert r.status_code == 404
