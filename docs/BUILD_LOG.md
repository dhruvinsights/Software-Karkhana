# Build log and learning guide

Every action taken to build Software Karkhana, why it was done, and where to learn the
technology behind it. Read top to bottom once; afterwards use it as a map.

For the concepts behind these actions (software factory, orchestration, control plane,
infrastructure), read [LEARNING_GUIDE.md](LEARNING_GUIDE.md) first.

Each section ends with **Check yourself**: one question. If you can answer it without
looking, you understand that part well enough to change it safely.

---

## Status: v2 rebuild (`feat/factory-v2`)

The v2 branch is a production-quality rebuild on top of the original hackathon foundation.
See [V2_PLAN.md](V2_PLAN.md) for the master plan and [docs/plans/](plans/) for detailed plans.

Key changes in v2:
- **No more `DEMO_FALLBACK`** — all responses come from real model calls or are marked unavailable.
- **Gemini + Ollama** as the two supported LLM providers (no other vendors); `LLM_PROVIDER` env var selects.
- **Multi-organization tenancy** — every row is scoped to an `org_id`; Postgres RLS enforces isolation.
- **Full onboarding** — org creation, invitations, role-scoped nav from `GET /api/nav`.
- **ADK worker adapter pilot** — ADK agent graph inside the existing `RunnerBackend` contract.
- **Shared context store** — Git-tracked + DB-mirrored context entries with agent read/write and human verification.
- **Review engine** — PR-Agent in isolated venv, or ADK reviewer; engine and model shown in the UI.
- **Audit events** — every state change writes to `audit_events` with actor, org and correlation ID.
- **Model usage metering** — per-org budget enforcement; alert at 80%; circuit breaker.

---

## 0. Decisions before code (Wed 21:00) — original hackathon

| Action | Why |
|---|---|
| Read `Features to build` (Tier A/B/C), the product blueprint and ADR-001 | The feature list defines "done" for each item, so tests are written against those exact checks. |
| Asked 4 questions: team size, GCP state, which Google base, which stack | Each answer changes the repo layout. Answers: 5+ people, no GCP project yet, Agent Starter Pack, Python + React. |
| Checked which Gemini models exist **today** | Found that `gemini-2.0-flash-001` retired on 1 Jun 2026 and Gemini 2.5 retires on **16 Oct 2026**, mid-hackathon. Chose `gemini-3-flash-preview` (the Agent Starter Pack default) and added `make check-models`. |
| Generated a real Agent Starter Pack project (`uvx agent-starter-pack create`) and copied its conventions | Judges from Google recognize the layout: `app/agent.py`, `app/fast_api_app.py`, `uv`, `ruff`, Apache headers, Google-style docstrings. |

**Learn**
- Agent Starter Pack: <https://github.com/GoogleCloudPlatform/agent-starter-pack> and its dev guide <https://goo.gle/asp-dev>
- Gemini model versions and retirement dates (check before every hackathon): <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions>
- Google Python style guide (docstrings, naming): <https://google.github.io/styleguide/pyguide.html>

**Check yourself:** why is pinning a model ID in code risky for a two-day build, and where would you change it?

---

## 1. Configuration that refuses unsafe production (`app/config.py`)

| Action | Why |
|---|---|
| One `Settings` class (pydantic-settings) reading env vars, with safe local defaults | All config in one typed place; Cloud Run sets real values. |
| A validator that **crashes on Cloud Run** if `AUTH_MODE=dev` or the HMAC secret is the default | Turns a silent security bug into a failed deploy you notice immediately. |
| `LLM_PROVIDER` (gemini/ollama) and `EMBED_PROVIDER` (gemini/ollama) env vars | v2: the provider is always explicit. Ollama is for local dev; Gemini is the production default. |

**Learn:** pydantic-settings <https://docs.pydantic.dev/latest/concepts/pydantic_settings/> · 12-factor config <https://12factor.net/config>

**Check yourself:** what exactly happens if someone deploys with `AUTH_MODE=dev`?

---

## 2. Database: Cloud SQL Postgres 16 + pgvector (`db/migrations`, `app/db.py`, `app/models.py`)

| Action | Why |
|---|---|
| Wrote plain SQL migrations; the SQL is the source of truth, ORM classes mirror it | Easy to review and run anywhere; no hidden migration magic. |
| Two database identities: **owner** (runs migrations) and **app** (Cloud Run) | Least privilege: the running app cannot change the schema. |
| `002_grants.sql` gives the app role only `SELECT, INSERT` on the ledger, `SELECT, INSERT` on approvals | Decisions and evidence can be written, never rewritten. |
| On Cloud Run the app logs in with **IAM database authentication** via the Cloud SQL Python Connector | No database password exists anywhere for the app. The service account *is* the login. |
| `learnings.embedding vector(768)` + HNSW index | Memory search runs inside the same database as everything else. One fewer service to deploy. |
| **v2: migration 004** adds `organizations`, `memberships`, `invitations`, `onboarding_state`, `context_entries`, `model_usage`, `audit_events`; adds `org_id` to `projects`, `learnings`, `ledger` | Multi-org tenancy requires every row to carry an org scope. |

**Learn**
- IAM database authentication: <https://docs.cloud.google.com/sql/docs/postgres/iam-logins>
- Cloud SQL Python Connector: <https://github.com/GoogleCloudPlatform/cloud-sql-python-connector>
- Vectors in Cloud SQL: <https://docs.cloud.google.com/sql/docs/postgres/work-with-vectors>
- pgvector (HNSW vs IVFFlat, distance operators): <https://github.com/pgvector/pgvector>
- SQLAlchemy 2.0 async: <https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html>

**Check yourself:** the app role tries `UPDATE ledger SET ...`. Which two separate mechanisms stop it?

---

## 3. Evidence ledger: a hash chain (`app/ledger.py`)

| Action | Why |
|---|---|
| Each row stores `prev_hash` and `hash = sha256(prev_hash + canonical_json(row))` | Editing or deleting any row breaks every later link, so tampering is *detectable*. |
| Canonical JSON (`sort_keys`, fixed separators, UTC microsecond timestamps) | The same content must always hash the same way, or verification fails on honest data. |
| `pg_advisory_xact_lock` before each append | Two Cloud Run instances writing at once would otherwise both link to the same parent and fork the chain. |
| A trigger blocks UPDATE/DELETE/TRUNCATE even for the owner | Defence in depth. |
| `GET /api/ledger/verify` recomputes from genesis | The "Verify chain" button in the demo. |
| **v2: one hash chain per org** (`chain key = org_id`) | Cross-org ledger contamination is structurally impossible. |

**Learn**
- Hash chains and tamper-evident logs: <https://certificate.transparency.dev/howctworks/>
- Postgres advisory locks: <https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS>
- Postgres triggers: <https://www.postgresql.org/docs/16/plpgsql-trigger.html>

**Check yourself:** what is the difference between *tamper-proof* and *tamper-evident*, and which does this ledger really provide?

---

## 4. Auth: Firebase Auth + roles from the database (`app/auth.py`)

| Action | Why |
|---|---|
| Browser signs in with Firebase (Google or email); server verifies the ID token with `firebase_admin` | Google-grade identity without building login. |
| The **role** is looked up in Cloud SQL on every request, never taken from the token or browser | A user cannot promote themselves to Director by editing client state. |
| Unknown accounts get 403 with `onboarding_required` code if they have no org membership | The UI routes them to the onboarding flow. |
| `require_role(Role.DIRECTOR)` dependency on `/approve` | Done-when: `/approve` is 403 for non-Directors even when called directly. |
| **v2: RBAC + ABAC** — every request checks `require_role` AND `scoped(query, user)` | Role alone is not enough; the resource must belong to the user's org. |

**Learn**
- Verify Firebase ID tokens on a server: <https://firebase.google.com/docs/auth/admin/verify-id-tokens>
- FastAPI dependencies (how `require_role` works): <https://fastapi.tiangolo.com/tutorial/dependencies/>
- Authentication vs authorization, OWASP: <https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>

**Check yourself:** why did we *not* use Firebase custom claims for roles?

---

## 5. Process engine: a transition table (`app/process.py`)

| Action | Why |
|---|---|
| The lifecycle stages as data, with `wired=True/False` | The tracker shows the full product vision honestly: unbuilt stages say "Planned". |
| `TRANSITIONS[(stage, status, event)] = (new_stage, new_status, allowed_roles)` | One table decides every move. Anything not in it is refused (409); the wrong role is refused (403). |
| Every move writes a ledger entry, including skipped planned stages | The audit trail shows exactly how a project got where it is. |
| **v2: every state change also writes to `audit_events`** | Per-org, correlation-ID-linked, machine-readable history for dashboards and security review. |

**Learn**
- Finite state machines, a gentle intro: <https://statecharts.dev/what-is-a-state-machine.html>
- `SELECT ... FOR UPDATE` row locks: <https://www.postgresql.org/docs/16/sql-select.html#SQL-FOR-UPDATE-SHARE>

**Check yourself:** a developer calls approve on a project still being evaluated. Which line of code refuses it, and with which HTTP status?

---

## 6. LLM provider layer (`app/ai/llm.py`, `app/ai/providers/`)

| Action | Why |
|---|---|
| `llm.chat()` and `llm.embed()` facade — the provider is never imported directly in a worker | Workers are provider-agnostic; changing `LLM_PROVIDER` is the only config change needed. |
| Gemini provider (`app/ai/providers/gemini.py`) | Production default on Vertex AI. |
| Ollama provider (`app/ai/providers/ollama.py`) | Local development and self-hosted inference; models with `tools` capability required for the Coder. |
| Removed `app/ai/genai.py` and `app/ai/fallbacks/` entirely | No more `DEMO_FALLBACK` — every response comes from a real model call. If the model is unavailable the endpoint returns an honest error. |
| `EMBED_PROVIDER=ollama` with `nomic-embed-text` (768-d) | Embeddings run locally without Vertex AI quota. Each `learnings` row stores `embedding_model`; switching providers triggers a re-embed job, not silent loss of recall. |

**Learn**
- Gemini on Vertex AI: <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/overview>
- Ollama API: <https://github.com/ollama/ollama/blob/main/docs/api.md>
- Tool/function calling (required for the Coder): <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling>

**Check yourself:** `LLM_PROVIDER=ollama` is set but Ollama is unreachable. What does the API return to the browser?

---

## 7. Evaluator: structured output + verification (`app/ai/evaluator.py`)

| Action | Why |
|---|---|
| `response_schema=<Pydantic model>` | Gemini (or Ollama with structured output) must answer in our exact JSON shape; we validate it again with Pydantic. |
| Retries with backoff and a hard timeout per call | A slow model call can never hang a request. |
| **Every epic's `source_quote` must appear in the idea text** (case/whitespace-normalized) | Blocks invented epics. |
| One repair pass that sends the exact errors back to the model | Most bad outputs are fixed on the second try. |
| Memory citations may only use IDs we retrieved; project, PR and verifier come from the DB | The model cannot fabricate a source. |
| **v2: evaluator prompts include top-k `context_entries` for the project** | Shared context from previous projects is available at evaluation time. Entry IDs are recorded in the ledger. |

**Learn**
- Structured output on Vertex AI: <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output>
- Google Gen AI Python SDK: <https://googleapis.github.io/python-genai/>

**Check yourself:** Gemini returns valid JSON with an epic quoting a sentence that is *not* in the idea. Trace what happens next.

---

## 8. Agents: ADK Coder, Reviewer and ADK worker adapter (`app/agents/`)

| Action | Why |
|---|---|
| Coder = ADK `LlmAgent` with exactly 5 tools: `list_files`, `read_file`, `write_file`, `replace_in_file`, `run_tests` | No shell, no network, no git. Every path is checked to stay inside the repo and away from `.git`. |
| `replace_in_file` must match exactly once | Small surgical edits instead of rewriting whole files. |
| Tests run with a **scrubbed environment** | pytest executes code the agent wrote, so it must not see `GITHUB_TOKEN` or `RUN_TOKEN`. |
| Reviewer = `LlmAgent` with `output_schema=ReviewOutput` | Comments arrive as typed data (path, severity, body). |
| **v2 ADK worker adapter pilot** — ADK `Agent` wrapped in `BaseWorker`-compatible class | ADK is the agent graph *inside* one worker step; Karkhana's workflow state machine remains outside ADK-specific objects. Swapping the implementation does not change the `RunnerBackend` contract. |
| ADK events streamed back as `RunEvent` rows | The live run view shows ADK tool calls and model steps as they happen. |

**Learn**
- ADK overview: <https://docs.cloud.google.com/agent-builder/agent-development-kit/overview>
- ADK docs (agents, tools, runners, sessions, evaluation): <https://adk.dev/>
- ADK samples: <https://github.com/google/adk-samples>
- Anthropic, "Building effective agents": <https://www.anthropic.com/engineering/building-effective-agents>

**Check yourself:** the Coder says "all tests pass", but they don't. Which component's number reaches GitHub, and why?

---

## 9. Worker and runner: Cloud Run Jobs + AX (`app/worker/`, `app/runner/`)

| Action | Why |
|---|---|
| Runner contract from ADR-001: `start / status / cancel / describe` | Local subprocess today, Cloud Run Jobs in production, AX or a customer's runner later, with no product code change. |
| One **Cloud Run Job execution per run**, env overrides carry only `RUN_ID`, `RUN_TOKEN`, `CALLBACK_URL` | Isolation, scale to zero, per-run identity. |
| Worker callbacks authenticated by a per-run **HMAC** token | The worker never holds user credentials. |
| Worker holds **no GitHub token**. It clones read-only, runs the agent and pytest, and returns a patch. The control plane (`app/publisher.py`) applies the patch to a fresh clone, pushes, opens the PR and sets the `karkhana/tests` status | pytest runs code the agent wrote; a token in the worker's env could be read by malicious test code. |
| **v2: AX runner** (`app/runner/ax.py`) — `axcheck` validates manifests before `ax apply` | google/ax (Apache-2.0) provides task-based sandbox orchestration. Manifests are RFC-1123 labelled; validation errors fail the run cleanly. If `ax` or `kubectl` is missing the API refuses to start a run with a 503 — no simulated cluster. |
| `runs.status` vs `runs.validation_status` separate | Failing tests open a **draft** PR and block merge; they can never masquerade as success. |

**Learn**
- Execute Cloud Run jobs: <https://docs.cloud.google.com/run/docs/execute/jobs>
- HMAC, what and why: <https://en.wikipedia.org/wiki/HMAC>
- Google AX: <https://github.com/google/ax>

**Check yourself:** a worker callback arrives twice, the second time claiming tests failed. What does the API do?

---

## 10. Onboarding, org and invitations (`app/routers/onboarding.py`)

| Action | Why |
|---|---|
| `POST /api/onboarding/org` creates the first org; the user becomes director | One API call, one org, one membership — role set server-side only. |
| `POST /api/team/invitations` + accept flow | 256-bit random token, hash stored, 7-day expiry, single use, accepting email must match. |
| `GET /api/nav` returns only the pages for the caller's role | The sidebar renders exactly this list; the server enforces the same restriction on every route. |
| A user with no membership gets 403 `onboarding_required` | The UI routes to onboarding instead of a blank screen. |

**Learn**
- Invitation token design: <https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html>
- RBAC vs ABAC: <https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>

**Check yourself:** an invitation email is intercepted. What stops someone else from using the token?

---

## 11. Shared context (`app/routers/context.py`, `app/memory.py`)

| Action | Why |
|---|---|
| `context_entries` table + Git-tracked Markdown under `.karkhana/context/` | DB for search; repo for human review. Both are always in sync because `POST /api/context` commits the file. |
| `nomic-embed-text` vectors (768-d) per entry | Semantic search without a separate vector store. |
| `source=agent` entries start `verified_at=NULL` | Agent-written context is available to search but not presented as authoritative until a lead verifies it. |
| `GET /api/context/pack/{task_id}` — bounded task context pack | Combines authority tier, semantic relevance, recency, file linkage, token budget and org permission filters. Source, confidence, `valid_from` and `review_by` included. |
| Cross-project retrieval denied by default; org_id filter first | No context leakage across orgs or projects. |

**Learn**
- Project Context (the OSS inspiration for Git-tracked context): <https://github.com/monomind-ai-lab/project-context>
- pgvector cosine search: <https://github.com/pgvector/pgvector>
- RAG overview: <https://docs.cloud.google.com/sql/docs/postgres/ai-overview>

**Check yourself:** an agent writes a learning that conflicts with a previously verified decision. What happens to the conflicting entry?

---

## 12. Review engine (`app/review/`)

| Action | Why |
|---|---|
| PR-Agent (MIT) in an isolated venv (`.venv-pr-agent`) in plain-diff mode | Real OSS reviewer; no GitHub token in the worker; isolated so version conflicts don't affect the main app. |
| `REVIEW_ENGINE` env var selects PR-Agent or ADK reviewer | Swappable adapter. |
| Engine and model shown from the PR record in the UI | The UI label says "Karkhana AI review (PR-Agent / qwen2.5-coder:14b)". No anonymised AI magic. |
| Zero-issues result is a valid clean review, not an error | A 14B local model may find nothing; that is honest. |

**Check yourself:** PR-Agent times out on a large diff. Which field on the PR record records this, and what does the UI show?

---

## 13. Review triage and memory (`app/routers/reviews.py`, `app/memory.py`)

| Action | Why |
|---|---|
| Merge blocked until every AI comment is Valid or Dismissed; dismissing needs a reason (API **and** DB constraint) | The UI greys the button, but the server enforces it. |
| On merge, the model distills one learning from the PR and its triage; saved **unverified**, linked to PR and comments | Dismissed comments are never presented as lessons. |
| Only a Lead or Director can verify; who and when are recorded | Unverified agent claims never reach the next project. |
| Retrieval returns only **verified** learnings above a similarity threshold | B3 behavior: confirmed knowledge only. |

**Learn**
- Cosine similarity: <https://www.pinecone.io/learn/vector-similarity/>
- RAG on Google Cloud: <https://docs.cloud.google.com/sql/docs/postgres/ai-overview>

**Check yourself:** why is "human verifies before reuse" the most important rule in the memory system?

---

## 14. Frontend (`web/`)

| Action | Why |
|---|---|
| React + TypeScript + Vite, TanStack Query for polling | Small, fast to change. |
| Firebase Web SDK sign-in; dev mode has role buttons | Same server-side role checks either way. |
| Sidebar built from `GET /api/nav` | A role sees only its permitted pages; the server enforces the same constraint. |
| **v2: all UI data from `/api/*` only** — no hardcoded rows, no seeded demo data | A blank dashboard means the data is genuinely absent, not hidden. Loading, empty, error states on every page. |
| Ledger panel, stage tracker, trust badges | A5, A6. Readable in black and white. |

**Learn:** React docs <https://react.dev/learn> · TanStack Query <https://tanstack.com/query/latest> · Firebase Auth for web <https://firebase.google.com/docs/auth/web/start>

---

## 15. Deploy: one config (`Dockerfile`, `cloudbuild.yaml`, `infra/bootstrap.sh`)

| Action | Why |
|---|---|
| Multi-stage Dockerfile: web build → Go binaries (`axcheck`, `ax`) → Python image with app, `web/dist`, Go binaries, `.venv-pr-agent` | One image, three roles (API, worker Job, migrate Job), non-root user. |
| `bootstrap.sh`: project, billing link, budget alert, APIs, service accounts, Cloud SQL, Secret Manager, bucket. Idempotent | Fresh project to deployable in one command, safe to re-run. |
| `cloudbuild.yaml`: build → push → migrate Job → smoke test `/healthz` and `/api/config` → deploy API → deploy worker Job → automatic rollback on smoke failure | One build, consistent code everywhere. Any smoke failure rolls back automatically. |
| Secrets only via `--set-secrets` from Secret Manager | Nothing sensitive in the image or the repo. |
| **v2: removed `_DEMO_FALLBACK`**; added `LLM_PROVIDER`, `EMBED_PROVIDER`, `REVIEW_ENGINE` | Provider choice is explicit; no silent fallback mode in production. |

**Learn**
- Cloud Build config reference: <https://docs.cloud.google.com/build/docs/build-config-file-schema>
- Cloud Run service identity (least privilege): <https://docs.cloud.google.com/run/docs/securing/service-identity>
- Secret Manager with Cloud Run: <https://docs.cloud.google.com/run/docs/configuring/services/secrets>

**Check yourself:** which service account can read the GitHub token, and which one deliberately has no database access?

---

## 16. Verification record

Every result below says **when, where and how** it was produced.

### v2 target state (feat/factory-v2, when all phases complete)

| Check | Environment | Command | Expected |
|---|---|---|---|
| Lint | Python 3.11, uv | `uv run ruff check app` · `ruff format --check app tests` | Clean |
| Unit + integration tests | PostgreSQL 16 + pgvector, `karkhana_app` role | `uv run pytest -q -rs` | All pass, 0 skipped |
| Frontend | Node 22 | `cd web && npx tsc -b && npm run build && npm audit` | Builds; 0 vulnerabilities |
| Security tests | Same | `uv run pytest tests/security/ -q` | All pass |
| Browser golden path | Ollama (qwen2.5-coder:14b) + local git remote | Playwright: onboarding → task → run → PR → triage → merge → ledger verify | All pass |
| No fallback references | — | `grep -ri "fallbacks\|DEMO_FALLBACK\|served_from_cache" app/ tests/ web/` | No matches |

### Original hackathon (Thu 15 Oct 2026, after review round 3) — historical

| Check | Environment | Command | Result |
|---|---|---|---|
| Lint | Linux sandbox, Python 3.13, uv | `uv run ruff check app` · `ruff format --check app tests` | Clean |
| Unit + integration tests | PostgreSQL 16.15 + pgvector | `uv run pytest -q -rs` | **46 passed, 0 skipped** |
| Frontend | Node 22 | `npm ci && npx tsc -b && npm run build && npm audit` | Builds; 0 vulnerabilities |
| Browser golden path | Real server + real worker subprocess + local git remote, `DEMO_FALLBACK=true` | `npm test` in `tests/e2e` | Full flow passed in 22 s |

**Skipped-test policy:** integration tests skip only when PostgreSQL is unreachable. CI
fails the build if anything is skipped, so a green CI always means the database tests ran.

---

## Suggested learning order for the team (about 3 hours total)

1. ADK quickstart, then `make playground` on the demo repo (45 min). Most important for the agent track.
2. Gemini structured output doc + `app/ai/evaluator.py` (30 min).
3. Cloud Run jobs + `app/runner/cloudrun_job.py` (20 min).
4. IAM database auth + `app/db.py` (20 min).
5. Read `tests/integration/test_golden_path.py` top to bottom (30 min). It is the whole product as one story.
6. pgvector README + `app/memory.py` + `app/routers/context.py` (20 min).
7. Ollama API + `app/ai/providers/ollama.py` (15 min).
8. `docs/plans/BACKEND_PLAN.md` (15 min) — the v2 entity model and context API.
