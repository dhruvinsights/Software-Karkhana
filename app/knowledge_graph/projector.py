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
"""Projects Postgres into the knowledge graph, driven by the evidence ledger.

Every project-scoped action already appends a ledger row with ``project_id``.
The projector tails the ledger, and for each touched project rewrites that
project's slice of its workspace graph from the tables. A rewrite stamps every
node and edge with a fresh generation and then deletes whatever still carries
an old one, so edits and deletions in Postgres propagate without diffing, and
readers never see a half-empty project.

One instance projects at a time (Postgres advisory lock). Everything is
idempotent, so a crash mid-tick is repaired by the next tick.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import logging
import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.knowledge_graph import client
from app.knowledge_graph.client import Graph
from app.knowledge_graph.snapshot import ProjectSnapshot, component_id, load, mentions

logger = logging.getLogger(__name__)

Embedder = Callable[[str], Awaitable[list[float] | None]]
PROJECT_LABELS = ("Epic", "Task", "Run", "PR", "ADR", "Issue", "Finding", "Learning", "Scenario")
_LOCK_KEY = 0x4B47  # "KG"
# A ledger row is only trusted as "no lower seq is still invisible" once it is
# this old, so the cursor never skips a transaction that committed late.
_SETTLE = dt.timedelta(seconds=30)
_BATCH = 500


def adr_text(a: dict) -> str:
    """The ADR text that is embedded and hashed."""
    return f"ADR-{a['number']}: {a['title']}\n{a['context']}\n{a['decision']}\n{a['rationale']}".strip()


async def _default_embed(t: str) -> list[float] | None:
    from app.ai import llm
    from app.ai.errors import ModelError

    try:
        return await llm.embed(t)
    except ModelError as exc:
        logger.warning("ADR embedding skipped: %s", exc)
        return None


def _embed_model() -> str:
    from app.ai import llm

    return llm.embed_model_name()


async def write_snapshot(
    g: Graph,
    snap: ProjectSnapshot,
    *,
    embed: Embedder = _default_embed,
    embed_model: str | None = None,
) -> str:
    """Writes one project's slice and removes anything stale. Returns the generation."""
    embed_model = embed_model or _embed_model()
    pid, scope = snap.project["id"], snap.scope
    gen = uuid.uuid4().hex
    base = {"pid": pid, "gen": gen}

    async def run(q: str, **params) -> list:
        res = await g.query(q, {**base, **params})
        return res.result_set

    # Product and project.
    await run(
        "MERGE (p:Project {id:$pid}) SET p.name=$name, p.stage=$stage, "
        "p.stage_status=$ss, p.workspace_id=$ws, p.gen=$gen",
        name=snap.project["name"], stage=snap.project["stage"],
        ss=snap.project["stage_status"], ws=snap.workspace_id,
    )
    if snap.product:
        await run(
            "MERGE (pr:Product {id:$id}) SET pr.name=$name, pr.code=$code, pr.domain=$domain "
            "WITH pr MATCH (p:Project {id:$pid}) MERGE (p)-[r:PART_OF]->(pr) SET r.gen=$gen",
            **snap.product,
        )

    # Components, product-scoped and shared by sibling projects.
    names = set(snap.vocabulary)
    for a in snap.adrs:
        names.update(a["components"])
    names.update(f["affected_component"].strip().lower() for f in snap.findings if f["affected_component"])
    vocab = sorted(n for n in names if n)
    if vocab:
        await run(
            "UNWIND $rows AS r MERGE (c:Component {id:r.id}) SET c.name=r.name, c.scope=$scope",
            rows=[{"id": component_id(scope, n), "name": n} for n in vocab], scope=scope,
        )

    def cid(n: str) -> str:
        return component_id(scope, n)

    await run(
        "UNWIND $rows AS r MERGE (e:Epic {id:r.id}) SET e.title=r.title, e.project_id=$pid, e.gen=$gen "
        "WITH e MATCH (p:Project {id:$pid}) MERGE (e)-[x:IN_PROJECT]->(p) SET x.gen=$gen",
        rows=snap.epics,
    )
    await run(
        "UNWIND $rows AS r MERGE (t:Task {id:r.id}) "
        "SET t.key=r.key, t.title=r.title, t.description=r.description, t.status=r.status, "
        "t.project_id=$pid, t.gen=$gen "
        "WITH t, r MATCH (e:Epic {id:r.epic_id}) MERGE (t)-[x:PART_OF]->(e) SET x.gen=$gen",
        rows=snap.tasks,
    )
    task_comps: dict[str, list[str]] = {
        t["id"]: mentions(f"{t['title']}\n{t['description']}\n{t['criteria']}", vocab) for t in snap.tasks
    }
    await run(
        "UNWIND $rows AS r MATCH (t:Task {id:r.t}), (c:Component {id:r.c}) "
        "MERGE (t)-[x:TOUCHES]->(c) SET x.gen=$gen, x.via='text_match'",
        rows=[{"t": t, "c": cid(n)} for t, ns in task_comps.items() for n in ns],
    )

    # ADRs: re-embed only when the text changed or the model did.
    existing = {
        r[0]: (r[1], r[2])
        for r in await run("MATCH (a:ADR {project_id:$pid}) RETURN a.id, a.text_hash, a.embedding_model")
    }
    for a in snap.adrs:
        body = adr_text(a)
        h = hashlib.sha256(body.encode()).hexdigest()
        await run(
            "MERGE (a:ADR {id:$id}) SET a.number=$number, a.title=$title, a.status=$status, "
            "a.decision=$decision, a.text_hash=$h, a.project_id=$pid, a.gen=$gen "
            "WITH a MATCH (p:Project {id:$pid}) MERGE (a)-[x:IN_PROJECT]->(p) SET x.gen=$gen",
            id=a["id"], number=a["number"], title=a["title"], status=a["status"],
            decision=a["decision"][:2000], h=h,
        )
        if existing.get(a["id"]) != (h, embed_model):
            vec = await embed(body)
            if vec is not None:
                await run(
                    "MATCH (a:ADR {id:$id}) SET a.embedding=vecf32($v), a.embedding_model=$m",
                    id=a["id"], v=vec, m=embed_model,
                )
        comps = a["components"]
        await run(
            "UNWIND $cs AS c MATCH (a:ADR {id:$id}), (k:Component {id:c}) "
            "MERGE (a)-[x:GOVERNS]->(k) SET x.gen=$gen",
            id=a["id"], cs=[cid(n) for n in comps],
        )
        pairs = [(cid(x), cid(y)) for i, x in enumerate(comps) for y in comps[i + 1:] if x != y]
        await run(
            "UNWIND $rows AS r MATCH (a:Component {id:r.a}), (b:Component {id:r.b}) "
            "MERGE (a)-[x:COUPLED_WITH {adr_id:$id}]->(b) SET x.project_id=$pid, x.gen=$gen",
            id=a["id"], rows=[{"a": x, "b": y} for x, y in pairs],
        )

    await run(
        "UNWIND $rows AS r MERGE (n:Run {id:r.id}) SET n.kind=r.kind, n.status=r.status, "
        "n.test_exit_code=r.test_exit_code, n.validation_status=r.validation_status, "
        "n.finished_at=r.finished_at, n.project_id=$pid, n.gen=$gen "
        "WITH n, r MATCH (t:Task {id:r.task_id}) MERGE (n)-[x:FOR_TASK]->(t) SET x.gen=$gen",
        rows=snap.runs,
    )
    await run(
        "UNWIND $rows AS r MERGE (pr:PR {id:r.id}) SET pr.number=r.number, pr.url=r.url, "
        "pr.status=r.status, pr.tests_passed=r.tests_passed, pr.merged_at=r.merged_at, "
        "pr.project_id=$pid, pr.gen=$gen "
        "WITH pr, r MATCH (t:Task {id:r.task_id}) MERGE (pr)-[x:IMPLEMENTS]->(t) SET x.gen=$gen "
        "WITH pr, r MATCH (n:Run {id:r.run_id}) MERGE (n)-[y:OPENED]->(pr) SET y.gen=$gen",
        rows=snap.prs,
    )

    await run(
        "UNWIND $rows AS r MERGE (i:Issue {id:r.id}) SET i.number=r.number, i.title=r.title, "
        "i.type=r.type, i.priority=r.priority, i.status=r.status, i.created_at=r.created_at, "
        "i.closed_at=r.closed_at, i.project_id=$pid, i.gen=$gen "
        "WITH i MATCH (p:Project {id:$pid}) MERGE (i)-[x:IN_PROJECT]->(p) SET x.gen=$gen",
        rows=snap.issues,
    )
    for rel, key, label in (("ON_TASK", "task_id", "Task"), ("LINKED_PR", "pr_id", "PR"), ("IN_EPIC", "epic_id", "Epic")):
        await run(
            f"UNWIND $rows AS r MATCH (i:Issue {{id:r.id}}), (n:{label} {{id:r.ref}}) "
            f"MERGE (i)-[x:{rel}]->(n) SET x.gen=$gen",
            rows=[{"id": i["id"], "ref": i[key]} for i in snap.issues if i[key]],
        )
    await run(
        "UNWIND $rows AS r MATCH (i:Issue {id:r.i}), (c:Component {id:r.c}) "
        "MERGE (i)-[x:TOUCHES]->(c) SET x.gen=$gen, x.via='text_match'",
        rows=[
            {"i": i["id"], "c": cid(n)}
            for i in snap.issues for n in mentions(f"{i['title']}\n{i['description']}", vocab)
        ],
    )

    await run(
        "UNWIND $rows AS r MERGE (f:Finding {id:r.id}) SET f.title=r.title, f.cve_id=r.cve_id, "
        "f.cwe=r.cwe_category, f.severity=r.severity, f.status=r.status, f.sla_deadline=r.sla_deadline, "
        "f.project_id=$pid, f.gen=$gen "
        "WITH f, r WHERE r.c IS NOT NULL MATCH (c:Component {id:r.c}) MERGE (f)-[x:AFFECTS]->(c) SET x.gen=$gen",
        rows=[
            {**f, "c": cid(f["affected_component"]) if f["affected_component"] else None}
            for f in snap.findings
        ],
    )
    await run(
        "UNWIND $rows AS r MERGE (s:Scenario {id:r.id}) SET s.title=r.title, s.type=r.type, "
        "s.status=r.status, s.project_id=$pid, s.gen=$gen "
        "WITH s, r WHERE r.issue_id IS NOT NULL MATCH (i:Issue {id:r.issue_id}) "
        "MERGE (s)-[x:VERIFIES]->(i) SET x.gen=$gen",
        rows=snap.scenarios,
    )

    # Learnings: reuse the pgvector embedding; never re-embed here.
    pr_task = {p["id"]: p["task_id"] for p in snap.prs}
    for lr in snap.learnings:
        await run(
            "MERGE (l:Learning {id:$id}) SET l.text=$text, l.status=$status, "
            "l.embedding_model=$m, l.created_at=$created_at, l.project_id=$pid, l.gen=$gen "
            "WITH l MATCH (p:Project {id:$pid}) MERGE (l)-[x:FROM_PROJECT]->(p) SET x.gen=$gen",
            id=lr["id"], text=lr["text"], status=lr["status"], m=lr["embedding_model"],
            created_at=lr["created_at"],
        )
        if lr["embedding"]:
            await run("MATCH (l:Learning {id:$id}) SET l.embedding=vecf32($v)", id=lr["id"], v=lr["embedding"])
        if lr["pr_id"]:
            await run(
                "MATCH (l:Learning {id:$id}), (pr:PR {id:$pr}) MERGE (l)-[x:FROM_PR]->(pr) SET x.gen=$gen",
                id=lr["id"], pr=lr["pr_id"],
            )
        about = set(mentions(lr["text"], vocab)) | set(task_comps.get(pr_task.get(lr["pr_id"]), []))
        await run(
            "UNWIND $cs AS c MATCH (l:Learning {id:$id}), (k:Component {id:c}) "
            "MERGE (l)-[x:ABOUT]->(k) SET x.gen=$gen",
            id=lr["id"], cs=[cid(n) for n in sorted(about)],
        )

    await link_similar_lessons(g, snap, gen=gen)

    # Anything not stamped with this generation is gone from Postgres.
    for lbl in ("Project", *PROJECT_LABELS):
        key = "id" if lbl == "Project" else "project_id"
        await run(f"MATCH (n:{lbl} {{{key}:$pid}})-[r]->() WHERE r.gen <> $gen DELETE r")
    await run("MATCH ()-[r:COUPLED_WITH {project_id:$pid}]->() WHERE r.gen <> $gen DELETE r")
    for lbl in PROJECT_LABELS:
        await run(f"MATCH (n:{lbl} {{project_id:$pid}}) WHERE n.gen <> $gen DETACH DELETE n")
    await run("MATCH (c:Component) WHERE NOT (c)--() DELETE c")
    return gen


async def link_similar_lessons(g: Graph, snap: ProjectSnapshot, *, gen: str, k: int = 6) -> None:
    """Links each verified learning here to verified look-alikes in *other* projects."""
    threshold = get_settings().kg_lesson_min_similarity
    pid = snap.project["id"]
    for lr in snap.learnings:
        if lr["status"] != "verified" or not lr["embedding"]:
            continue
        await g.query(
            "CALL db.idx.vector.queryNodes('Learning', 'embedding', $k, vecf32($v)) YIELD node AS o, score "
            "WITH o, 1.0 - score AS sim "
            "WHERE o.project_id <> $pid AND o.status = 'verified' AND o.embedding_model = $m AND sim >= $t "
            "MATCH (l:Learning {id:$id}) MERGE (l)-[x:SIMILAR_TO]->(o) SET x.score=sim, x.gen=$gen",
            {"k": k, "v": lr["embedding"], "pid": pid, "m": lr["embedding_model"],
             "t": threshold, "id": lr["id"], "gen": gen},
        )


async def delete_project(g: Graph, project_id: str) -> None:
    """Removes a deleted or archived project's slice."""
    for lbl in PROJECT_LABELS:
        await g.query(f"MATCH (n:{lbl} {{project_id:$pid}}) DETACH DELETE n", {"pid": project_id})
    await g.query("MATCH ()-[r:COUPLED_WITH {project_id:$pid}]->() DELETE r", {"pid": project_id})
    await g.query("MATCH (p:Project {id:$pid}) DETACH DELETE p", {"pid": project_id})
    await g.query("MATCH (c:Component) WHERE NOT (c)--() DELETE c")


async def sync_project(
    session: AsyncSession, project_id: uuid.UUID, *, workspace_hint: uuid.UUID | str | None = None
) -> bool:
    """Rewrites one project's slice from Postgres. Returns False when the graph is off."""
    if not client.enabled():
        return False
    snap = await load(session, project_id)
    name = client.graph_name(snap.workspace_id if snap else workspace_hint)
    g = client.graph(name)
    await client.ensure_schema(g, name)
    if snap is None:
        await delete_project(g, str(project_id))
    else:
        await write_snapshot(g, snap)
    return True


# --- Ledger tailing ---------------------------------------------------------

async def _get_cursor() -> int:
    res = await client.graph(client.META_GRAPH).query("MATCH (c:Cursor {key:'ledger'}) RETURN c.seq")
    return int(res.result_set[0][0]) if res.result_set else 0


async def _set_cursor(seq: int) -> None:
    await client.graph(client.META_GRAPH).query(
        "MERGE (c:Cursor {key:'ledger'}) SET c.seq=$s, c.at=$at",
        {"s": seq, "at": dt.datetime.now(dt.UTC).isoformat()},
    )


async def sync_from_ledger(session: AsyncSession) -> int:
    """One tick: re-project every project touched since the cursor. Returns projects synced."""
    from app.models import LedgerEntry

    got = await session.scalar(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": _LOCK_KEY})
    if not got:
        return 0  # Another instance is projecting.
    cursor = await _get_cursor()
    rows = (
        await session.execute(
            select(LedgerEntry.seq, LedgerEntry.project_id, LedgerEntry.workspace_id, LedgerEntry.created_at)
            .where(LedgerEntry.seq > cursor)
            .order_by(LedgerEntry.seq)
            .limit(_BATCH)
        )
    ).all()
    if not rows:
        return 0
    touched: dict[uuid.UUID, uuid.UUID | None] = {}
    for _, pid, ws, _ in rows:
        if pid is not None:
            touched[pid] = ws
    for pid, ws in touched.items():
        try:
            await sync_project(session, pid, workspace_hint=ws)
        except Exception:
            logger.exception("Knowledge graph sync failed for project %s", pid)
            return len(touched)  # Leave the cursor; retry next tick.
    # Advance only through the settled prefix; newer rows are re-read next tick
    # (re-projection is idempotent), so a late-committing lower seq is never skipped.
    settled = dt.datetime.now(dt.UTC) - _SETTLE
    new_cursor = cursor
    for seq, _, _, at in rows:
        if at is None or at > settled:
            break
        new_cursor = seq
    if new_cursor != cursor:
        await _set_cursor(new_cursor)
    return len(touched)


async def run_forever() -> None:
    """Background loop started from the API lifespan when FalkorDB is configured."""
    from app.db import sessionmaker

    s = get_settings()
    while True:
        try:
            async with sessionmaker()() as session:
                n = await sync_from_ledger(session)
                await session.commit()
            if n:
                logger.info("Knowledge graph: re-projected %d project(s)", n)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Knowledge graph tick failed")
        await asyncio.sleep(s.kg_sync_interval_s)


async def rebuild_all(session: AsyncSession) -> int:
    """Drops every workspace graph and re-projects all live projects."""
    from app.models import LedgerEntry, Project

    if not client.enabled():
        return 0
    db = client._client()
    for name in await db.list_graphs():
        if name.startswith("kg_"):
            await db.select_graph(name).delete()
    client._ready.clear()
    ids = (await session.scalars(select(Project.id).where(Project.archived_at.is_(None)))).all()
    for pid in ids:
        await sync_project(session, pid)
    head = await session.scalar(select(func.max(LedgerEntry.seq)))
    await _set_cursor(int(head or 0))
    return len(ids)
