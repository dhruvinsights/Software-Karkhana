# Engineering Intelligence Graph — FalkorDB Integration

> **Audience**: contributors, reviewers and engineers swapping the backend.
> **Not in main README** by design — this is implementation detail.

---

## What this is

Software Karkhana uses a **property graph** to give every AI agent focused,
relationship-aware context instead of a raw text dump.  The graph lives in
`app/graph/` and is completely optional — if
FalkorDB is not running the system falls back to a `NullBackend` and operates
exactly as it did before.

---

## Five use-cases wired in production

### UC-1 · Context scoping (token savings)

**Problem**: `BaseWorker` used to inject up to 6 000 chars of flat evidence
text before every agent run.  Most of that context was irrelevant to the
specific files the agent would touch.

**Solution**: Before compressing evidence, `BaseWorker._graph_context_prefix()`
queries the graph for a 1-hop neighbourhood of the task's touched files:

```
Graph query:
  touched files → callers (IMPORTS edges) → tests (TESTED_BY edges)
                → linked requirements (IMPLEMENTED_BY edges)
```

The result is a ~200-char structured prefix injected at the top of the
evidence block.  Everything outside the neighbourhood is still available via
the compressed evidence below it.

**Where it's wired**: [`app/services/run_context.py`](../karkhana/app/services/run_context.py) →
`BaseWorker._graph_context_prefix()` called in `BaseWorker.run()`.

---

### UC-2 · Parallel-safety conflict detection

**Problem**: Two tasks assigned to different agents could both plan to touch
`auth/service.py`.  The second agent would overwrite the first agent's changes
mid-run with no warning.

**Solution**: Every scheduler tick, before dispatching a task, the scheduler
calls `_graph_conflict_blocks()`.  This runs a 2-hop OpenCypher query:

```cypher
MATCH (me:Task {id: $task_id})-[:TOUCHES]->(f:File)<-[:TOUCHES]-(other:Task)
WHERE other.id IN $active_ids AND other.id <> $task_id
RETURN other.id, f.path
```

If any file overlap is found, the task is `nack`-ed back to the queue and
tried again on the next tick (after the conflicting task completes).

**Where it's wired**: [`app/services/parallel_planner.py`](../karkhana/app/services/parallel_planner.py) →
`TaskScheduler._graph_conflict_blocks()` called in `_tick()`.

**TOUCHES edges are written by**: `PlannerWorker._parse_result()` → parses the
`FILES_TO_CHANGE:` block from the plan output and calls
`_graph_record_task_touches()`.

---

### UC-3 · Impact blast radius

**Problem**: When a task modifies a file, no one knows which callers, tests,
other tasks, or requirements are now affected without manually tracing the
codebase.

**Solution**: `GraphBackend.get_blast_radius()` does a multi-hop traversal:

```
changed_files
  → IMPORTS reverse     → affected_callers
  → TESTED_BY           → affected_tests
  → TOUCHES reverse     → affected_tasks
  → IMPLEMENTED_BY→Task→ affected_requirements
```

This is exposed as a FastAPI endpoint (add `/api/tasks/{id}/blast-radius`) or
called from the Reviewer agent to surface downstream impact in its evidence.

**Where it's available**: `karkhana.graph.get_graph().get_blast_radius()`

---

### UC-4 · Requirement traceability

**Problem**: Product asks "which code implements requirement REQ-42?" — today
there is no answer without searching git history manually.

**Solution**: `link_requirement()` writes `(Req)-[:IMPLEMENTED_BY]->(Task)`
edges when a task is linked to a requirement.  `get_requirement_trace()` then
returns all task IDs + file paths that implement it.

**Where it's available**: `karkhana.graph.get_graph().link_requirement()` +
`get_requirement_trace()` — call from the UI or API layer when requirements are
approved.

---

### UC-5 · Agent revisit memory

**Problem**: A Debugger agent is sent to the same file for the third time with
no knowledge of what the previous two attempts did or why they failed.

**Solution**: `_graph_record_attempt()` is called by each worker after its run
completes (success or failure).  It writes an `(:Attempt)-[:ON_FILE]->(:File)`
edge with the phase, outcome and a 300-char summary.

The next worker run gets up to 3 previous attempts prepended to its context
via `BaseWorker._graph_context_prefix()`:

```
## Prior Agent Attempts (avoid repeating failed approaches)
✗ [TESTING] test_auth.py::test_token_expiry failed — missing import in utils.py
✓ [DEBUGGING] Added missing import, test now passes
```

**Where it's wired**: `BaseWorker._graph_context_prefix()` calls
`get_revisit_memory()`.  Workers should call `_graph_record_attempt()` after
each `_parse_result()` — see `TesterWorker` and `DebuggerWorker` for examples.

---

## File layout

```
app/graph/
  __init__.py          → exports get_graph()
  base.py              → GraphBackend ABC + ScopedContext / BlastRadius / etc.
  factory.py           → singleton factory, env-var config, fallback logic
  falkordb_backend.py  → FalkorDB (SSPL v1) implementation
  null_backend.py      → no-op fallback (always safe, no server required)
```

---

## Running FalkorDB locally

```bash
# Docker (quickest)
docker run -p 6379:6379 falkordb/falkordb:latest

# Install the Python client
cd packages/orchestrator
/opt/homebrew/bin/python3.11 -m pip install -e ".[graph]"

# Verify connection
python3.11 -c "from karkhana.graph import get_graph; g = get_graph(); print(g.is_available())"
```

Environment variables (all optional, sensible defaults):

| Variable | Default | Description |
|---|---|---|
| `KARKHANA_GRAPH_HOST` | `localhost` | FalkorDB host |
| `KARKHANA_GRAPH_PORT` | `6379` | FalkorDB port |
| `KARKHANA_GRAPH_NAME` | `karkhana` | Graph name inside FalkorDB |
| `KARKHANA_GRAPH_DISABLED` | `0` | Set to `1` to disable entirely (CI, no Redis) |

---

## Swapping the backend

**The only file you need to change is `factory.py`.**

```python
# factory.py — line 25-30 (the only backend import in the codebase)

# Current (FalkorDB, SSPL v1):
from karkhana.graph.falkordb_backend import FalkorDBBackend as _BACKEND_CLASS

# Option A — Kuzu (Apache 2.0, embedded, no server needed, recommended for SaaS):
# from karkhana.graph.kuzu_backend import KuzuBackend as _BACKEND_CLASS

# Option B — Neo4j (community AGPL or enterprise):
# from karkhana.graph.neo4j_backend import Neo4jBackend as _BACKEND_CLASS

# Option C — disable completely:
# from karkhana.graph.null_backend import NullBackend as _BACKEND_CLASS
```

Then implement the new class by inheriting `GraphBackend` from `base.py` and
implementing all abstract methods.  The `NullBackend` is a good template —
it shows the minimal method signatures.

**pyproject.toml change** (only if the new backend has a different package):

```toml
[project.optional-dependencies]
graph = [
    "kuzu>=0.7.0",   # replaces falkordb
]
```

---

## License note

FalkorDB core is **SSPL v1** — not OSI-certified open source.  This is fine
for internal tooling and non-SaaS deployments.  If Software
Karkhana becomes a hosted SaaS offering, replace with:

- **Kuzu** (`kuzu>=0.7.0`, Apache 2.0, embedded, no Redis/server needed)
- **Apache AGE** (PostgreSQL extension, Apache 2.0 — reuses your existing DB)
- **FalkorDB Cloud** (commercial license, removes SSPL restriction)

The GraphRAG SDK from FalkorDB is separately Apache 2.0 and is not used here.

---

## Graph schema (quick reference)

```
Nodes
  (:File   {id, project_id, path, language, is_test})
  (:Task   {id, project_id, title})
  (:Req    {id, project_id, text})
  (:Attempt{id, project_id, task_id, phase, success, summary, ts})

Edges
  (:File)-[:IMPORTS]->(:File)           added by: ExplorerWorker (static analysis)
  (:File)-[:TESTED_BY]->(:File)         added by: ExplorerWorker (heuristic)
  (:Task)-[:TOUCHES]->(:File)           added by: PlannerWorker (FILES_TO_CHANGE)
  (:Req)-[:IMPLEMENTED_BY]->(:Task)     added by: API layer / future feature
  (:Attempt)-[:ON_FILE]->(:File)        added by: every worker after run
```

---

## What is NOT in the graph

- Raw source code content (stays in Git)
- Full conversation transcripts (stays in Evidence table)
- Binary files, images, lockfiles
- Auth tokens or secrets

The graph stores **identifiers, relationships, and short summaries only**.
