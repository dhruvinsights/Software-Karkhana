# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""End to end: HTTP API -> Postgres + ledger -> projector -> FalkorDB -> coder run spec.

Needs a FalkorDB server (``KG_TEST_URL``, default redis://localhost:6379);
skipped when none is reachable.
"""

from __future__ import annotations

import datetime as dt
import os

import pytest

from app.knowledge_graph import client as kg
from app.knowledge_graph import projector, queries
from app.runner.base import run_token
from tests.fakes import IDEAS
from tests.integration.test_golden_path import (  # noqa: F401
    DEV,
    DIR,
    LEAD,
    PM,
    as_,
    client,
    fakes,
    wait_for_stage,
)

URL = os.environ.get("KG_TEST_URL", "redis://localhost:6379")
pytestmark = pytest.mark.usefixtures("database")


def _reachable() -> bool:
    try:
        from falkordb import FalkorDB

        FalkorDB.from_url(URL).select_graph("kg_ping").query("RETURN 1")
        return True
    except Exception:
        return False


@pytest.fixture
def graph_on(monkeypatch):
    if not _reachable():
        pytest.skip("no FalkorDB server")
    from app.config import get_settings

    monkeypatch.setenv("FALKORDB_URL", URL)
    get_settings.cache_clear()
    kg.set_client(None)
    monkeypatch.setattr(projector, "_SETTLE", dt.timedelta(0))
    yield
    get_settings.cache_clear()


async def tick() -> int:
    from app.db import sessionmaker

    async with sessionmaker()() as s:
        n = await projector.sync_from_ledger(s)
        await s.commit()
    return n


async def test_graph_end_to_end(client, fakes, graph_on):
    # Idea -> evaluation -> director approval, all over HTTP.
    idea = IDEAS["discounts"]
    r = await client.post("/api/projects", json={"name": "KG e2e", "idea_text": idea["idea_text"]}, headers=as_(PM))
    assert r.status_code == 202, r.text
    pid = r.json()["id"]
    detail = await wait_for_stage(client, pid, "evaluated")
    assert (await client.post(f"/api/projects/{pid}/approve", json={"decision": "approved"}, headers=as_(DIR))).status_code == 200
    task = detail["tasks"][0]
    comp = [w for w in task["title"].lower().replace(",", " ").split() if len(w) > 4][-1]

    # Architecture, security and a bug, recorded through the stations.
    r = await client.post(f"/api/projects/{pid}/adrs", headers=as_(LEAD), json={
        "title": "Round discounts once, at invoice close", "status": "accepted",
        "decision": "Use Decimal and round half-even once.", "affected_components": [comp, "invoice-ledger"]})
    assert r.status_code == 201, r.text
    r = await client.post(f"/api/projects/{pid}/security-findings", headers=as_(LEAD), json={
        "title": "Ledger accepts negative totals", "severity": "HIGH", "affected_component": "invoice-ledger"})
    assert r.status_code == 201, r.text
    r = await client.post(f"/api/projects/{pid}/issues", headers=as_(LEAD), json={
        "title": f"Wrong total in {comp}", "type": "bug", "priority": "P1"})
    assert r.status_code == 201, r.text
    bug_id = r.json()["id"]

    # Developer starts a run; the projector picks everything up from the ledger.
    r = await client.post(f"/api/tasks/{task['id']}/runs", headers=as_(DEV))
    assert r.status_code == 202, r.text
    run_id = r.json()["id"]
    assert await tick() >= 1

    spec = (await client.get(f"/internal/runs/{run_id}/spec", headers={"Authorization": f"Run {run_token(run_id)}"})).json()
    graph_notes = {(c["title"], c["body"]) for c in spec["context"] if c["kind"] == "graph"}
    titles = " | ".join(t for t, _ in graph_notes)
    print("\nGRAPH NOTES:", *sorted(graph_notes), sep="\n  ")
    assert any(t.startswith("ADR-") and "(accepted)" in t for t, _ in graph_notes), titles
    assert any("HIGH finding on invoice-ledger" in t for t, _ in graph_notes), titles  # via coupling
    assert any(t.startswith("Open bug #") for t, _ in graph_notes), titles

    g = kg.graph(kg.graph_name(detail["project"]["workspace_id"]))
    product_scope = detail["project"]["product_id"] or pid
    blast = await queries.blast_radius(g, f"{product_scope}:invoice-ledger")
    assert f"{product_scope}:{comp}" in blast["components"] and blast["open_findings"]
    rca = await queries.rca(g, bug_id)
    assert rca["adrs"] and rca["adrs"][0][1].startswith("Round discounts"), rca
    print("BLAST:", blast, "\nRCA:", rca)

    # Superseding the ADR in Postgres removes it from agent context on the next tick.
    adr_id = (await client.get(f"/api/projects/{pid}/adrs", headers=as_(LEAD))).json()
    adr_id = (adr_id[0] if isinstance(adr_id, list) else adr_id["adrs"][0])["id"]
    assert (await client.patch(f"/api/adrs/{adr_id}", json={"status": "superseded"}, headers=as_(LEAD))).status_code == 200
    await tick()
    spec = (await client.get(f"/internal/runs/{run_id}/spec", headers={"Authorization": f"Run {run_token(run_id)}"})).json()
    assert not any(c["kind"] == "graph" and c["title"].startswith("ADR-") for c in spec["context"])

    # The graph is disposable: a full rebuild reproduces the same slice.
    from app.db import sessionmaker

    before = (await g.query("MATCH (n {project_id:$p}) RETURN count(n)", {"p": pid})).result_set[0][0]
    async with sessionmaker()() as s:
        assert await projector.rebuild_all(s) >= 1
    g = kg.graph(kg.graph_name(detail["project"]["workspace_id"]))
    after = (await g.query("MATCH (n {project_id:$p}) RETURN count(n)", {"p": pid})).result_set[0][0]
    assert before == after > 0
