# Runner, review and shared-context plan

> **Blueprint alignment:** this plan implements Blueprint §9 (agent execution and orchestration), §8 (shared context), and §10 (OSS reuse strategy). OSS candidates are evaluated against Blueprint §10.1 criteria: upstream URL, license, maintenance, security, data model, API maturity, deployment footprint, tenancy model, upgrade path and exit strategy.

## 1. google/ax runner (`app/runner/ax.py`)

Source: `third_party/ax` (Apache-2.0). Validator: `tools/axcheck`.

Blueprint §9 worker contract: every worker supports `prepare → run → stream events → checkpoint → pause/resume → cancel → collect artifacts → verify → teardown`.

Design:
- Implements the `RunnerBackend` protocol (`start / status / cancel / describe`).
- `start()` builds three manifests in `ax.io/v1alpha1`:
  - `Workspace`: git repo, branch from the run spec.
  - `Model`: provider `google`, model from `GEMINI_MODEL`, secret named by `AX_MODEL_SECRET`.
  - `Task`: image `AX_TASK_IMAGE`, env from `worker_env(run_id)`, workspace binding, resource limits.
- Names are RFC 1123 labels, for example `run-<first 12 hex of run id>`.
- Every manifest set goes through `axcheck` before `ax apply -f -`. A validation error fails the run with the validator's message.
- `status()` parses `ax get tasks -a <atespace>` (columns `NAME ATESPACE PHASE ACTOR WORKER-IP AGE`). Phase map: Running -> running, Failed -> failed, Suspended/Terminating -> unknown with detail.
- `cancel()` runs `ax delete`.
- `get_backend()` returns it for `RUNNER_BACKEND=ax`.
- The worker keeps its trust boundary: no GitHub token, HMAC callbacks only. The task image must contain this app's worker and serve `/healthz` and `/readyz` on port 80 as the AX runner contract requires.

Worker result (Blueprint §9 worker contract):
- Exit code, changed files, commit/branch/PR links, tool-call trace, logs, tests and checks.
- Model/provider metadata, cost, context pack version, acceptance-criterion mapping, verification status and human-review requirement.
- An agent response alone is never success.

Honest status (Blueprint principle: "No fake integrations"):
- If `ax` or `kubectl` is missing, or the cluster is unreachable, `describe()` and `/api/runner/status` return the real error and `start()` refuses the run with a 503.
- No simulated cluster.

Tests: manifest generation snapshot, axcheck accept/reject, status parsing from recorded `ax get` output, missing-CLI error path.

### ADK worker adapter (Blueprint §10.1 — pilot)

Google ADK Python is the primary agent framework candidate. The worker abstraction (`RunnerBackend`) is Karkhana-owned; ADK is the agent graph inside a worker, not the workflow state machine itself. Pilot steps:

1. Wrap an ADK `Agent` in a `BaseWorker`-compatible class.
2. Pass the context pack as an ADK `Session` state object.
3. Stream ADK events back as `RunEvent` rows.
4. Keep Karkhana workflow state (task status, gates, evidence) outside ADK-specific objects.
5. If ADK API changes break compatibility, swap the implementation without changing the `RunnerBackend` contract.

### Scion adapter (Blueprint §10.1 — evaluate)

Google Cloud Scion supports agent collaboration with multiple harnesses, workspaces/worktrees and local-to-cloud operation. Pilot steps:
- Validate current repo maturity, auth, multi-tenancy and operational fit before production adoption.
- Wrap behind the `RunnerBackend` interface; validate contract tests before enabling.
- Gate on: multi-tenant isolation confirmed, auth integration tested, operational runbook written.

### Genkit integration (Blueprint §10.1 — selective)

Use Genkit selectively for app features (e.g. streaming generative flows, provider-agnostic embeddings) where it reduces work versus ADK. Avoid duplicating ADK orchestration without a clear boundary.

## 2. Review engine

Done in code: `app/review/` runs PR-Agent in plain-diff mode in `.venv-pr-agent`, or the ADK reviewer. Remaining:
- Unit tests for `parse_review`: zero issues, severity inference, security concern, bad line numbers.
- Subprocess test with a stub interpreter (timeout, non-zero exit, missing output file).
- Config docs: `REVIEW_ENGINE`, `PR_AGENT_PYTHON`, `REVIEW_TIMEOUT_S`.
- UI label: "Karkhana AI review", with engine and model shown from the PR record.

Blueprint §12 AI code review rules:
- Review agent annotates diff lines with severity, evidence and suggested fixes.
- Reviewers triage findings as valid, invalid, duplicate or accepted risk.
- Track false-positive rate, finding resolution and recurrence.
- **AI never approves its own changes or bypasses branch protection.**

## 3. Shared context (Blueprint §8)

The shared context is a governed, permission-filtered context service — not "give every agent the entire chat history."

### Context scopes implemented in v2 (Blueprint §8.1)

| Scope | v2 implementation |
|---|---|
| Run context | Task, acceptance criteria, selected files, relevant instructions; assembled by `GET /api/context/pack/{task_id}` |
| Task thread | Attempts, comments, test outcomes and decisions stored in ledger |
| Project context | Brief, architecture, ADRs, constraints, terminology, status and learnings in `context_entries` |
| Repository context | Git-tracked Markdown under `.karkhana/context/` |

Team context and org context (scope 4 and 5) are future tracks requiring memory promotion workflow.

### Sources and licenses

- TeamContext (Apache-2.0): vendored in `third_party/TeamContext`, used for its Git-native layout ideas.
- project-context (MIT + Commons Clause), shared-context-mcp (no license), shared-brain (no license): ideas only, no code copied.

### Design

- Git-tracked Markdown store under `CONTEXT_DIR` (`.karkhana/context/`): `decisions/`, `state.md`, `learnings/`. Each file has front matter (id, kind, author, created, project).
- DB table `context_entries` mirrors files for search, with `nomic-embed-text` vectors.
- Retrieval: hybrid keyword + semantic search, filters by org/project/kind/verified, recency and source quality (Blueprint §8.2).
- **Conflict handling:** mark conflicting claims; prefer canonical artifacts and latest approved decisions; never silently overwrite an approved decision; ask a human when material ambiguity remains.
- **Privacy:** secrets never enter context. Redact tokens, credentials and personal data. Cross-project retrieval is denied by default.
- **Staleness:** attach `valid_from`, `review_by`, `supersedes` and freshness signals. Stale context is visibly labelled.
- API: `GET /api/context` (search + filter), `POST /api/context` (write entry, also commits the file), `GET /api/context/{id}`, `PUT /api/context/{id}/verify`, `GET /api/context/pack/{task_id}`.
- Agents read it: the evaluator and Coder prompts include the top-k relevant entries for the project, and the ledger records which entry ids were used.
- Agents write it: merge-time learnings and run summaries are saved as entries with `source=agent`, unverified until a lead verifies them.
- Optional MCP endpoint exposing the same read/write tools, so external coding agents (Gemini CLI, ADK agents) can share the context.

### MCP Toolbox integration (Blueprint §10.1)

Use Google MCP Toolbox for governed database access from agents:
- Configure restricted queries, IAM allowlists and read/write separation.
- Expose `context_entries` search and task state reads as approved MCP tools.
- Do not allow arbitrary SQL from agent tool calls.

### Future: live event channel (Blueprint §8.2)

Publish context changes to active sessions over an event bus/WebSocket; subscribers re-fetch authorized deltas. v2.0 uses polling; future tracks add Pub/Sub streaming and the live context timeline screen (screen 66).

## 4. Providers

- Gemini: `GEMINI_API_KEY`, or Vertex ADC as the fallback. Production default (Blueprint §10.2).
- Ollama: `OLLAMA_BASE_URL`, chat model `OLLAMA_MODEL` / `OLLAMA_CODER_MODEL`, embeddings `nomic-embed-text`. Local dev and self-hosted production only.
- Models with the "tools" capability are required for the Coder: `qwen2.5-coder:14b`, `granite3.3:8b`, `llama3.2`, `gpt-oss:20b` all report it.
- Remove any other vendor reference from code, docs, UI and env files.
- Provider adapter interface: all workers call through `llm.chat()` and `llm.embed()` — the provider is never imported directly in a worker.

## 5. Integration adapter contract (Blueprint §17)

Every adapter (GitHub, Gemini, Ollama, AX) must implement:
- connect / authorize / revoke
- health check and capabilities
- fetch/import
- create/update where authorized
- webhook validation (HMAC, replay-protected, idempotent)
- retry and dead-letter handling
- sync cursor and replay
- mapping configuration (external IDs → Karkhana domain objects)
- audit trail
- rate-limit handling
- contract tests and test fixtures

Integration status labels: `Not configured | Configured | Healthy | Degraded | Re-authentication required | Sync paused | Failed`. Demo mode must be visually obvious (Blueprint §10.3).
