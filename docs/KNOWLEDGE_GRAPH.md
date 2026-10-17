# Knowledge graph (FalkorDB)

Postgres is the record. The graph is a **derived, rebuildable projection** used for
multi-hop questions and agent context. Nothing exists only in the graph.

## How it stays in sync
Every project-scoped action already appends a ledger row with `project_id`. A background
loop (`app/knowledge_graph/projector.py`) tails the ledger and re-projects each touched
project from the tables. Each rewrite stamps nodes/edges with a new generation and deletes
older ones, so edits and deletions propagate. One instance projects at a time (advisory lock);
the cursor only advances past rows older than 30 s so late commits are never skipped.

- Enable: `FALKORDB_URL=redis://localhost:6379` (unset = off; every call returns empty).
- Local server: `docker run -p 6379:6379 falkordb/falkordb`
- Rebuild from scratch: `python -m app.knowledge_graph rebuild`

## Model (one graph per workspace: `kg_<workspace_id>`)
Product ← Project ← Epic ← Task; Run → Task; PR → Task; ADR -GOVERNS→ Component;
Component -COUPLED_WITH- Component (listed together in an ADR); Task/Issue -TOUCHES→ Component
(text match against the product's component vocabulary); Finding -AFFECTS→ Component;
Issue → Task / PR / Epic; Scenario → Issue; Learning → PR, Project, Component (ABOUT);
Learning -SIMILAR_TO- Learning across projects (verified only, cosine ≥ `KG_LESSON_MIN_SIMILARITY`).

Components are product-scoped, so an ADR in one project governs tasks in its sibling projects.
Learning vectors are reused from pgvector; ADRs are embedded once per content hash.

## Named queries (`app/knowledge_graph/queries.py`)
| Query | Answers |
|---|---|
| `governing_adrs(task)` | Which live ADRs govern this task, via which component |
| `blast_radius(component)` | Coupled components and the tasks, ADRs, open findings on them |
| `rca(issue)` | Issue → PR/Task/Epic → components → ADRs and prior verified lessons |
| `related_lessons(learning)` | Verified look-alike lessons from other projects |
| `agent_context(task, vec)` | Hybrid: graph-governed ADRs + vector-similar ADRs, open findings (incl. coupled components), verified lessons, open bugs |

`agent_context` is wired into `GET /internal/runs/{id}/spec` as `kind="graph"` context notes.

## Known limits
- Task→component links come from text matching; a task that never names a component gets no
  structural links (vector seeds still apply). An explicit component field would be stronger.
- Re-projection rewrites a whole project per touched ledger row; fine at current scale.
