# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""One pass through the graph layer on an embedded FalkorDB: project, query, re-project."""

from __future__ import annotations

import asyncio
import math

import pytest

lite = pytest.importorskip("redislite.falkordb_client")

from app.knowledge_graph import projector, queries  # noqa: E402
from app.knowledge_graph.client import ensure_schema  # noqa: E402
from app.knowledge_graph.snapshot import ProjectSnapshot, component_id  # noqa: E402

DIM = 768
M = "test/embed"


def vec(*hot: int) -> list[float]:
    v = [0.0] * DIM
    for i in hot:
        v[i] = 1.0
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v]


class AsyncGraph:
    """Async facade over the embedded (sync) graph."""

    def __init__(self, g):
        self.g = g

    async def query(self, q, params=None):
        return self.g.query(q, params or {})


def snap(pid: str, *, adrs, tasks, learnings, prs=(), issues=(), findings=()) -> ProjectSnapshot:
    return ProjectSnapshot(
        project={"id": pid, "workspace_id": "ws1", "name": pid, "stage": "build", "stage_status": "active"},
        product={"id": "prod1", "name": "Payments", "code": "PAY", "domain": "fin"},
        epics=[{"id": f"{pid}-e1", "title": "Refunds"}],
        tasks=[{"epic_id": f"{pid}-e1", "description": "", "criteria": "", "status": "ready", **t} for t in tasks],
        prs=list(prs), adrs=list(adrs), issues=list(issues), findings=list(findings),
        learnings=[{"embedding_model": M, "created_at": None, "pr_id": None, **lr} for lr in learnings],
        vocabulary=["refund-service", "ledger-service"],
    )


def adr(id_, n, title, comps, status="accepted"):
    return {"id": id_, "number": n, "title": title, "status": status, "context": "",
            "decision": title, "rationale": "", "components": comps}


def test_project_query_and_reproject(tmp_path):
    g = AsyncGraph(lite.FalkorDB(str(tmp_path / "kg.db")).select_graph("kg_ws1"))

    async def fake_embed(text):
        return vec(1) if "idempot" in text.lower() else vec(2)

    async def go():
        from app.knowledge_graph import client
        client._ready.discard("kg_ws1")
        await ensure_schema(g, "kg_ws1")
        # Project A: the ADR and an old lesson.
        a = snap("A", adrs=[adr("adr7", 7, "Idempotent refund writes", ["refund-service", "ledger-service"]),
                            adr("adr9", 9, "Old approach", ["refund-service"], status="superseded")],
                 tasks=[{"id": "tA", "key": "A-1", "title": "Build refund-service"}],
                 learnings=[{"id": "LA", "text": "refund-service retries need idempotency keys",
                             "status": "verified", "embedding": vec(1, 3)}])
        await projector.write_snapshot(g, a, embed=fake_embed, embed_model=M)
        # Project B (same product): a task, PR, bug, finding, look-alike lesson, unverified lesson.
        b = snap("B", adrs=[],
                 tasks=[{"id": "tB", "key": "B-1", "title": "Partial refunds in refund-service"}],
                 prs=[{"id": "prB", "task_id": "tB", "run_id": None, "number": 12, "url": "u",
                       "status": "merged", "tests_passed": True, "merged_at": None}],
                 issues=[{"id": "iB", "number": 3, "title": "Double refund", "description": "",
                          "type": "bug", "priority": "P1", "status": "todo", "task_id": None,
                          "pr_id": "prB", "epic_id": None, "created_at": None, "closed_at": None}],
                 findings=[{"id": "fB", "title": "No rate limit", "cve_id": None, "cwe_category": "",
                            "severity": "HIGH", "status": "open", "affected_component": "ledger-service",
                            "sla_deadline": None}],
                 learnings=[{"id": "LB", "text": "retry storms on refunds", "status": "verified",
                             "embedding": vec(1, 3, 4)},
                            {"id": "LX", "text": "skip idempotency in refund-service", "status": "unverified",
                             "embedding": vec(1)}])
        await projector.write_snapshot(g, b, embed=fake_embed, embed_model=M)

        govern = await queries.governing_adrs(g, "tB")
        assert [x["number"] for x in govern] == [7]  # Cross-project; superseded excluded.

        ctx = await queries.agent_context(g, "tB", vec(1), M)
        assert any(x["number"] == 7 for x in ctx["adrs"])
        assert "refund-service retries need idempotency keys" in ctx["lessons"]
        assert not any("skip idempotency" in t for t in ctx["lessons"])  # Unverified filtered.
        assert ("No rate limit", "HIGH", "ledger-service") in [tuple(r) for r in ctx["open_findings"]]

        blast = await queries.blast_radius(g, component_id("prod1", "ledger-service"))
        assert component_id("prod1", "refund-service") in blast["components"]  # Coupled via ADR-7.
        assert {r[0] for r in blast["tasks"]} == {"A-1", "B-1"}

        r = await queries.rca(g, "iB")
        assert r["pr"]["number"] == 12 and r["task"]["key"] == "B-1"
        assert [7, "Idempotent refund writes"] in r["adrs"]

        assert [x[0] for x in await queries.related_lessons(g, "LB")] == [
            "refund-service retries need idempotency keys"]

        # Re-project A without its ADR: deletions propagate, nothing duplicates.
        a.adrs = []
        await projector.write_snapshot(g, a, embed=fake_embed, embed_model=M)
        assert await queries.governing_adrs(g, "tB") == []
        assert (await g.query("MATCH (t:Task) RETURN count(t)")).result_set[0][0] == 2

    loop = asyncio.new_event_loop()  # Not asyncio.run: it unsets the loop other tests use.
    try:
        loop.run_until_complete(go())
    finally:
        loop.close()
