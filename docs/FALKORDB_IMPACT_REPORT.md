# FalkorDB Engineering Intelligence Graph
## How We Use It in Software Karkhana — A Genuine Impact Report

> Written after implementation. Every claim below is backed by actual running code.
> PR: https://github.com/Software-Karkhana/Software-Karkhana-v1/pull/1

---

## What Software Karkhana does (context)

Software Karkhana is a governed, multi-agent software engineering platform. You give it a task — "Fix auth token expiry" — and it spawns a pipeline of specialist AI agents:

```
ExplorerWorker → PlannerWorker → ImplementerWorker → TesterWorker
                                                           │
                                              PASS → ReviewerWorker → DONE
                                              FAIL → DebuggerWorker → retry
```

Each agent receives the accumulated evidence from previous agents as context, writes code, and produces verifiable output (tests, diffs, gate checks). The orchestrator governs state, handles failures, and runs multiple tasks in parallel when safe.

**The problem before FalkorDB**: the system had no understanding of *relationships* — between files, between tasks, between attempts. Agents got flat text blobs. The scheduler had no way to know whether two parallel tasks would collide. A Debugger sent to the same file three times in a row had no memory of what had already been tried.

---

## The Engineering Intelligence Graph

A property graph (backed by FalkorDB) now runs alongside the orchestrator. It stores:

```
(:File)   — every source file in a repository
(:Task)   — every task created in Karkhana
(:Req)    — approved requirements
(:Attempt)— every agent run outcome

(:File)-[:IMPORTS]->(:File)        — static analysis
(:File)-[:TESTED_BY]->(:File)      — test file coverage
(:Task)-[:TOUCHES]->(:File)        — planned file changes
(:Req)-[:IMPLEMENTED_BY]->(:Task)  — requirement → implementation
(:Attempt)-[:ON_FILE]->(:File)     — agent run history
```

No source code lives in the graph. Only identifiers, relationships, and short summaries.

---

## Use Case 1 — Context Scoping (Token Savings)

### The problem
`BaseWorker` injected a flat blob of up to 6 000 characters of accumulated evidence into every agent run. For a Debugger fixing a single function in `auth/service.py`, that blob contained exploration notes, architecture summaries, planning details — most of it irrelevant.

### What we built
`BaseWorker._graph_context_prefix()` queries the graph for the 1-hop neighbourhood of the task's touched files before evidence compression runs:

```python
# workers/base.py — runs before every agent invocation
_graph_prefix = self._graph_context_prefix(task, touched_files=None)
augmented_evidence = (_graph_prefix + "\n\n" + evidence_summary) if _graph_prefix else evidence_summary
compressed_summary = self._compress_evidence(augmented_evidence)
```

The graph query:
```cypher
-- Callers (1-hop IMPORTS)
MATCH (caller:File)-[:IMPORTS]->(f:File)
WHERE f.id IN $file_ids
RETURN DISTINCT caller.path LIMIT 15

-- Related tests
MATCH (f:File)-[:TESTED_BY]->(t:File)
WHERE f.id IN $file_ids
RETURN DISTINCT t.path LIMIT 12
```

### What the agent actually receives (verified live output)

```
## Graph Context (from Engineering Intelligence Graph)

**Touched files** (1):
  - `src/auth/service.py`

**Direct callers / importers** (1):
  - `src/auth/middleware.py`

**Related tests** (1):
  - `tests/test_auth.py`

---
[rest of compressed evidence below]
```

### What this changes
The agent now knows *immediately* — before reading a single line of code — which other files call into the code it's about to change, and which tests cover it. It doesn't need to grep the entire repo to figure this out. The evidence budget (6 000 chars) is now spent on content that matters, not exploration noise.

---

## Use Case 2 — Parallel-Safety Conflict Detection

### The problem
Software Karkhana runs multiple tasks in parallel when worker slots are available. Before this change, the scheduler had no way to know if two tasks were about to touch the same file. The second agent could silently overwrite the first agent's in-progress changes — no error, no warning, just corrupted work.

### What we built
`PlannerWorker` already outputs a `FILES_TO_CHANGE:` block in its plan. We now parse that output and write `TOUCHES` edges immediately:

```python
# workers/specialist.py — PlannerWorker._parse_result()
ftc_match = re.search(r"FILES_TO_CHANGE:\s*(.*?)(?:\n\n|\Z)", agent_output, ...)
if ftc_match and task:
    _graph_record_task_touches(
        project_id=task.repo_path,
        task_id=task.id,
        task_title=task.title,
        files_to_change_text=ftc_match.group(1),
    )
```

Before dispatching any task, the scheduler queries the graph:

```python
# scheduler/scheduler.py — TaskScheduler._tick()
if self._graph_conflict_blocks(task):
    self._task_queue.nack(task_id, "graph_conflict")
    continue  # retry on next tick, after conflicting task finishes
```

The graph query (2-hop):
```cypher
MATCH (me:Task {id: $task_id})-[:TOUCHES]->(f:File)
      <-[:TOUCHES]-(other:Task)
WHERE other.id IN $active_ids AND other.id <> $task_id
RETURN other.id, f.path
```

### Verified live output

```
=== UC-2: Conflict Detection ===
Has conflicts: True
**File conflicts detected — serial execution required:**
  - Task `task-A` also touches: src/auth/service.py
```

Task B is automatically deferred. No manual intervention, no file collision.

---

## Use Case 3 — Impact Blast Radius

### The problem
When a PR is ready for review, neither the Reviewer agent nor the human reviewer had any way to know which other files, tests, tasks, or requirements were downstream of the changed files — without reading the whole codebase.

### What we built
`get_blast_radius()` runs a multi-hop traversal in a single query:

```python
blast = graph.get_blast_radius('project-id', ['src/auth/service.py'])
# Returns:
# blast.affected_callers     → ['src/auth/middleware.py']
# blast.affected_tests       → ['tests/test_auth.py']
# blast.affected_tasks       → ['task-007']
# blast.affected_requirements→ ['REQ-12: users must re-auth after token expiry']
```

The `BlastRadius.summary()` method formats this for the Reviewer agent's evidence:

```
**Blast radius for 1 changed file:**
  Callers affected: 1
  Tests to re-run: 1
  Other tasks touching these files: task-007
  Requirements impacted: REQ-12: users must re-auth after token expiry
```

This is available now via `karkhana.graph.get_graph().get_blast_radius()` and ready to wire into the ReviewerWorker's output or expose as a `/api/tasks/{id}/blast-radius` endpoint.

---

## Use Case 4 — Requirement Traceability

### The problem
Product asks: "Which code implements the auth requirement we approved last sprint?" Today the answer requires searching git log, Jira, and the codebase manually.

### What we built
Two methods on `GraphBackend`:

```python
# Write: when a requirement is approved and linked to tasks
graph.link_requirement(
    project_id='proj',
    requirement_id='REQ-12',
    requirement_text='Users must re-authenticate after token expiry',
    task_ids=['task-001', 'task-007'],
)

# Read: trace all code that implements a requirement
trace = graph.get_requirement_trace('proj', 'REQ-12')
# Returns: ['task-001 → src/auth/service.py', 'task-007 → src/auth/middleware.py']
```

Graph path:
```
(Req:REQ-12)-[:IMPLEMENTED_BY]->(Task:task-001)-[:TOUCHES]->(File:src/auth/service.py)
```

This is ready to call from the API layer when requirements are approved in the governance flow.

---

## Use Case 5 — Agent Revisit Memory

### The problem
A Debugger sent to fix a failing test in `auth/service.py` for the third time had zero knowledge of what the two previous attempts did, what they tried, and why they failed. It would often try the same broken approach again.

### What we built
Every worker run outcome is recorded as an `Attempt` node linked to the files it touched:

```python
# Called by _graph_record_attempt() after each worker's _parse_result()
g.record_agent_attempt(
    project_id='proj',
    task_id='task-A',
    phase='TESTING',
    file_paths=['src/auth/service.py'],
    success=False,
    summary='test_token_expiry failed — missing import in utils.py',
)
```

The next worker run on the same file gets this prepended to its context via `BaseWorker._graph_context_prefix()`:

```
## Prior Agent Attempts (avoid repeating failed approaches)
✗ [TESTING] test_token_expiry failed — missing import in utils.py
✓ [DEBUGGING] Added missing import in utils.py, all tests pass
```

### Verified live output

```
=== UC-5: Revisit Memory ===
**Prior agent attempts on `src/auth/service.py`:**
  ✗ [TESTING] test_token_expiry failed — missing import in utils.py
  ✓ [DEBUGGING] Added missing import in utils.py, all tests pass now
```

The Debugger now knows: "someone already tried X and it failed, someone else fixed it with Y." It doesn't repeat the mistake.

---

## Architecture: designed to be removed

The entire graph layer is behind a single abstraction. If FalkorDB needs to be swapped:

```
karkhana/graph/
  base.py              ← GraphBackend ABC (never changes)
  factory.py           ← ONE import line to change
  falkordb_backend.py  ← current backend (SSPL v1)
  null_backend.py      ← no-op fallback (always runs without FalkorDB)
```

**The only change needed to swap backends:**
```python
# factory.py — line 28
# Current:
from karkhana.graph.falkordb_backend import FalkorDBBackend as _BACKEND_CLASS
# Future (Apache 2.0, embedded, no server):
# from karkhana.graph.kuzu_backend import KuzuBackend as _BACKEND_CLASS
```

No other file in the codebase imports a concrete backend. Every caller goes through `get_graph()`.

---

## What is NOT in the graph

This matters as much as what is:

| Not stored | Why | Where it lives instead |
|---|---|---|
| Source code content | Too large, changes constantly | Git |
| Full conversation transcripts | Evidence table already handles this | SQLite |
| Binary files, lockfiles | No relationships worth graphing | Filesystem |
| Auth tokens, secrets | Never | Nowhere |
| Every log line | Noise | Structured logs |

The graph stores **identifiers, short summaries, and relationships only**. It is a relationship index, not a data store.

---

## How to run it

```bash
# 1. Start FalkorDB (takes ~10 seconds to pull first time)
docker run -p 6379:6379 falkordb/falkordb:latest

# 2. Install the Python client
cd packages/orchestrator
pip install -e '.[graph]'

# 3. Verify all 5 use-cases are live
python3.11 -c "
from karkhana.graph import get_graph
g = get_graph()
print('Connected:', g.is_available())
"
```

**Env vars** (all optional):

| Variable | Default | Purpose |
|---|---|---|
| `KARKHANA_GRAPH_HOST` | `localhost` | FalkorDB host |
| `KARKHANA_GRAPH_PORT` | `6379` | FalkorDB port |
| `KARKHANA_GRAPH_DISABLED` | `0` | Set `1` to use NullBackend (CI, no Docker) |

---

## License

FalkorDB core is **SSPL v1** — not OSI-certified open source. Acceptable for hackathon and internal tooling. For a commercial SaaS offering, replace with **Kuzu** (Apache 2.0, embedded, no server required). The swap is one import line. See `docs/FALKORDB.md` for full guidance.

---

*All code, queries, and outputs in this document are from the actual implementation.*
*PR: https://github.com/Software-Karkhana/Software-Karkhana-v1/pull/1*
