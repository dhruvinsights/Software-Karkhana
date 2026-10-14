# Software Karkhana

One record for every team, from idea to merged code. A PM writes an idea, Gemini
evaluates it, a Director approves it, a Google ADK agent builds a story and opens a
real GitHub PR, a developer triages the AI review, and the lesson learned is reused
on the next project. Every step is written to a hash-chained evidence ledger.

Built on the [Agent Starter Pack](https://github.com/GoogleCloudPlatform/agent-starter-pack)
layout (ADK `app/` directory, `uv`, `ruff`, Cloud Run).

## Architecture

```
Browser (React, Firebase Auth)
   │  ID token
   ▼
Cloud Run: karkhana API (FastAPI)                     ── control plane, owns all state
   ├─ auth.py        Firebase token → role from Cloud SQL (never from the client)
   ├─ process.py     15 stages + transition table: the only way a project moves
   ├─ ledger.py      SHA-256 hash chain, advisory-locked appends
   ├─ ai/evaluator   Gemini structured output → schema + verbatim-quote checks → 1 repair
   ├─ memory.py      pgvector retrieval of *verified* learnings only
   └─ runner/        ADR-001 contract: local subprocess | Cloud Run Job execution
           │ start(run) with RUN_ID + per-run HMAC token
           ▼
Cloud Run Job: karkhana-worker                        ── one execution per run
   read-only clone → ADK Coder (5 workspace-confined tools) → worker runs pytest
   → ADK Reviewer (typed output) → HMAC callback with the patch and real exit code
   (no GitHub token: tests run untrusted code)
Control plane publishes: branch, PR (draft if tests failed), commit status, review
Cloud SQL Postgres 16 + pgvector (IAM auth; app role cannot UPDATE/DELETE the ledger)
Secret Manager · Cloud Storage (run artifacts) · Cloud Logging · Cloud Build · Artifact Registry
```

## Feature map

| Feature | Where |
|---|---|
| A1 roles, 403 on `/approve` | `app/auth.py`, `require_role` on every write route |
| A2, A3 idea and evaluation | `app/routers/projects.py`, `app/ai/evaluator.py` |
| A4 approval gate | `POST /api/projects/{id}/approve`, `app/process.py` |
| A5 ledger | `app/ledger.py`, `db/migrations/*`, ledger panel on every screen |
| A6, A7 stages and board | `GET /api/stages`, `/board`; Draft until approval |
| A8-A10 agent, PR, triage | `app/agents/`, `app/worker/main.py`, `app/routers/runs.py`, `reviews.py` |
| A11 deploy | `cloudbuild.yaml`, `infra/bootstrap.sh`, `Dockerfile` |
| B1-B3 memory | `app/memory.py`, learnings page, citations enriched from the DB |
| B4 trust badges | `web/src/components/common.tsx` |
| B5 portfolio and gates | `GET /api/portfolio` |
| C4 Google Chat, C5 fallbacks | `app/integrations/chat.py`, `app/ai/fallbacks/` |

## Run locally

```bash
make install && make db-local && make migrate
make dev      # API on :8080
make web      # UI on :5173, sign in as any demo role
make test     # 46 tests: unit + integration against real Postgres
```

On Windows (Postgres + pgvector via WSL2, diagnosing slow tests): [docs/LOCAL_WINDOWS.md](docs/LOCAL_WINDOWS.md).

For the agent run locally, point the worker at a git remote:
`DEMO_REPO_URL=file:///path/to/bare/invoicekit.git make dev`.

## Deploy

See [docs/GO_LIVE.md](docs/GO_LIVE.md). Team split: [docs/TEAM_PLAN.md](docs/TEAM_PLAN.md).
Demo: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).
Every build decision and how to learn the stack: [docs/BUILD_LOG.md](docs/BUILD_LOG.md).
The ideas underneath (software factory, orchestration, infra), taught: [docs/LEARNING_GUIDE.md](docs/LEARNING_GUIDE.md).

## Honest scope

Wired: evaluate, plan, implement, validate, PR, review, feedback. Onboard, design,
architecture, env, QA, security, CI/CD and release are shown as **Planned**, and their
gates stay pending. Nothing in the product claims production readiness.
