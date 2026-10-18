# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Named graph queries. Agents call these, never raw Cypher."""

from __future__ import annotations

from typing import Any

from app.knowledge_graph.client import Graph

LIVE_ADR = "a.status IN ['proposed','accepted']"


async def _rows(g: Graph, q: str, **p: Any) -> list[list]:
    return (await g.query(q, p)).result_set


async def governing_adrs(g: Graph, task_id: str) -> list[dict]:
    """ADRs governing the components a task touches, from any project of the product."""
    rows = await _rows(
        g,
        f"MATCH (t:Task {{id:$t}})-[:TOUCHES]->(c:Component)<-[:GOVERNS]-(a:ADR) WHERE {LIVE_ADR} "
        "RETURN DISTINCT a.id, a.number, a.title, a.status, a.project_id, c.name",
        t=task_id,
    )
    return [dict(zip(("id", "number", "title", "status", "project_id", "via"), r, strict=True)) for r in rows]


async def blast_radius(g: Graph, component_id: str, depth: int = 2) -> dict:
    """Coupled components, and the tasks, ADRs and open findings that depend on them."""
    d = max(1, min(depth, 3))
    rows = await _rows(
        g, f"MATCH (c:Component {{id:$c}}) OPTIONAL MATCH (c)-[:COUPLED_WITH*1..{d}]-(o:Component) "
        "WITH c, collect(DISTINCT o.id) AS os RETURN c.id, os", c=component_id)
    comps = list(dict.fromkeys([rows[0][0], *rows[0][1]])) if rows else []
    tasks = await _rows(g, "MATCH (t:Task)-[:TOUCHES]->(c:Component) WHERE c.id IN $cs "
                        "RETURN DISTINCT t.key, t.title, t.project_id", cs=comps)
    adrs = await _rows(g, f"MATCH (a:ADR)-[:GOVERNS]->(c:Component) WHERE c.id IN $cs AND {LIVE_ADR} "
                       "RETURN DISTINCT a.number, a.title, a.project_id", cs=comps)
    findings = await _rows(g, "MATCH (f:Finding)-[:AFFECTS]->(c:Component) WHERE c.id IN $cs "
                           "AND f.status = 'open' RETURN DISTINCT f.title, f.severity", cs=comps)
    return {"components": comps, "tasks": tasks, "adrs": adrs, "open_findings": findings}


async def rca(g: Graph, issue_id: str) -> dict:
    """Issue -> PR/Task -> components -> governing ADRs, findings and prior lessons."""
    chain = await _rows(
        g, "MATCH (i:Issue {id:$i}) OPTIONAL MATCH (i)-[:LINKED_PR]->(pr:PR) "
        "OPTIONAL MATCH (i)-[:ON_TASK]->(t1:Task) OPTIONAL MATCH (pr)-[:IMPLEMENTS]->(t2:Task) "
        "WITH i, pr, coalesce(t1, t2) AS t OPTIONAL MATCH (t)-[:PART_OF]->(e:Epic) "
        "RETURN i.title, pr.number, pr.url, t.id, t.key, t.title, e.title", i=issue_id)
    if not chain:
        return {}
    title, pr_no, pr_url, tid, tkey, ttitle, epic = chain[0]
    comps = [r[0] for r in await _rows(
        g, "MATCH (n)-[:TOUCHES]->(c:Component) WHERE n.id IN $ids RETURN DISTINCT c.id",
        ids=[x for x in (issue_id, tid) if x])]
    adrs = await _rows(g, f"MATCH (a:ADR)-[:GOVERNS]->(c:Component) WHERE c.id IN $cs AND {LIVE_ADR} "
                       "RETURN DISTINCT a.number, a.title", cs=comps)
    lessons = await _rows(g, "MATCH (l:Learning {status:'verified'})-[:ABOUT]->(c:Component) "
                          "WHERE c.id IN $cs RETURN DISTINCT l.text, l.project_id", cs=comps)
    return {"issue": title, "pr": {"number": pr_no, "url": pr_url},
            "task": {"key": tkey, "title": ttitle}, "epic": epic,
            "components": comps, "adrs": adrs, "prior_lessons": lessons}


async def related_lessons(g: Graph, learning_id: str) -> list[list]:
    """Verified look-alike lessons from other projects."""
    return await _rows(
        g, "MATCH (l:Learning {id:$l})-[s:SIMILAR_TO]-(o:Learning {status:'verified'}) "
        "RETURN o.text, o.project_id, s.score ORDER BY s.score DESC", l=learning_id)


async def agent_context(g: Graph, task_id: str, query_vec: list[float] | None, model: str) -> dict:
    """Hybrid retrieval: graph-governed facts, plus vector seeds expanded along edges."""
    adrs = await governing_adrs(g, task_id)
    seen = {a["id"] for a in adrs}
    if query_vec:
        for r in await _rows(
            g, "CALL db.idx.vector.queryNodes('ADR','embedding',4,vecf32($v)) YIELD node AS a, score "
            f"WHERE {LIVE_ADR} AND a.embedding_model = $m AND score < 0.5 "
            "RETURN a.id, a.number, a.title, a.status, a.project_id", v=query_vec, m=model):
            if r[0] not in seen:
                seen.add(r[0])
                adrs.append(dict(zip(("id", "number", "title", "status", "project_id"), r, strict=True), via="similar"))
    # Findings on touched components and anything one coupling hop away.
    # (FalkorDB has no zero-length hops, so collect touched + coupled first.)
    findings = await _rows(g, "MATCH (:Task {id:$t})-[:TOUCHES]->(c0:Component) "
                           "OPTIONAL MATCH (c0)-[:COUPLED_WITH]-(c1:Component) "
                           "WITH collect(DISTINCT c0) + collect(DISTINCT c1) AS cs UNWIND cs AS c "
                           "MATCH (c)<-[:AFFECTS]-(f:Finding {status:'open'}) "
                           "RETURN DISTINCT f.title, f.severity, c.name", t=task_id)
    lessons = await _rows(
        g, "MATCH (:Task {id:$t})-[:TOUCHES]->(c)<-[:ABOUT]-(l:Learning {status:'verified'}) "
        "OPTIONAL MATCH (l)-[:SIMILAR_TO]-(o:Learning {status:'verified'}) "
        "WITH collect(DISTINCT l.text) + collect(DISTINCT o.text) AS xs UNWIND xs AS x RETURN DISTINCT x",
        t=task_id)
    if query_vec:
        lessons += await _rows(
            g, "CALL db.idx.vector.queryNodes('Learning','embedding',3,vecf32($v)) YIELD node AS l, score "
            "WHERE l.status = 'verified' AND l.embedding_model = $m AND score < 0.45 RETURN l.text",
            v=query_vec, m=model)
    bugs = await _rows(g, "MATCH (:Task {id:$t})-[:TOUCHES]->(c)<-[:TOUCHES]-(i:Issue) "
                       "WHERE i.type IN ['bug','security'] AND i.status <> 'done' "
                       "RETURN DISTINCT i.number, i.title", t=task_id)
    return {"adrs": adrs, "open_findings": findings,
            "lessons": list(dict.fromkeys(r[0] for r in lessons)), "open_bugs": bugs}
