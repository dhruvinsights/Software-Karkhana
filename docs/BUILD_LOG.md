# Build log and learning guide

Every action taken to build Software Karkhana, why it was done, and where to learn the
technology behind it. Read top to bottom once; afterwards use it as a map.

For the concepts behind these actions (software factory, orchestration, control plane,
infrastructure), read [LEARNING_GUIDE.md](LEARNING_GUIDE.md) first.

Each section ends with **Check yourself**: one question. If you can answer it without
looking, you understand that part well enough to change it safely.

---

## 0. Decisions before code (Wed 21:00)

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
| `learnings.embedding vector(768)` + HNSW index | Memory search (B3) runs inside the same database as everything else. One fewer service to deploy. |

**Learn**
- IAM database authentication: <https://docs.cloud.google.com/sql/docs/postgres/iam-logins>
- Cloud SQL Python Connector: <https://github.com/GoogleCloudPlatform/cloud-sql-python-connector> and the short tutorial <https://cloud.google.com/blog/topics/developers-practitioners/how-connect-cloud-sql-using-python-easy-way>
- Vectors in Cloud SQL: <https://docs.cloud.google.com/sql/docs/postgres/work-with-vectors>
- pgvector itself (HNSW vs IVFFlat, distance operators): <https://github.com/pgvector/pgvector>
- SQLAlchemy 2.0 async: <https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html>

**Check yourself:** the app role tries `UPDATE ledger SET ...`. Which two separate mechanisms stop it?

---

## 3. Evidence ledger: a hash chain (`app/ledger.py`) — A5

| Action | Why |
|---|---|
| Each row stores `prev_hash` and `hash = sha256(prev_hash + canonical_json(row))` | Editing or deleting any row breaks every later link, so tampering is *detectable*. |
| Canonical JSON (`sort_keys`, fixed separators, UTC microsecond timestamps) | The same content must always hash the same way, or verification fails on honest data. |
| `pg_advisory_xact_lock` before each append | Two Cloud Run instances writing at once would otherwise both link to the same parent and fork the chain. |
| A trigger blocks UPDATE/DELETE/TRUNCATE even for the owner | Defence in depth. A Cloud SQL superuser could still disable it, which is why the chain (evidence) matters more than the lock (prevention). |
| `GET /api/ledger/verify` recomputes from genesis | The "Verify chain" button in the demo. |

**Learn**
- Hash chains and tamper-evident logs, the idea behind Certificate Transparency: <https://certificate.transparency.dev/howctworks/>
- Postgres advisory locks: <https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS>
- Postgres triggers: <https://www.postgresql.org/docs/16/plpgsql-trigger.html>

**Check yourself:** what is the difference between *tamper-proof* and *tamper-evident*, and which does this ledger really provide?

---

## 4. Auth: Firebase Auth + roles from the database (`app/auth.py`) — A1

| Action | Why |
|---|---|
| Browser signs in with Firebase (Google or email); server verifies the ID token with `firebase_admin` | Google-grade identity without building login. |
| The **role** is looked up in Cloud SQL on every request, never taken from the token or browser | A user cannot promote themselves to Director by editing client state. Changing a role needs no token refresh. |
| Unknown accounts get 403 | Signing in with any Google account is not enough to get in. |
| `require_role(Role.DIRECTOR)` dependency on `/approve` | Done-when for A1: `/approve` is 403 for non-Directors even when called directly. |

**Learn**
- Verify Firebase ID tokens on a server: <https://firebase.google.com/docs/auth/admin/verify-id-tokens>
- FastAPI dependencies (how `require_role` works): <https://fastapi.tiangolo.com/tutorial/dependencies/>
- Authentication vs authorization, OWASP: <https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>

**Check yourself:** why did we *not* use Firebase custom claims for roles?

---

## 5. Process engine: a transition table (`app/process.py`) — A4, A6, A7

| Action | Why |
|---|---|
| The 15 lifecycle stages as data, with `wired=True/False` | The tracker shows the full product vision honestly: unbuilt stages say "Planned". |
| `TRANSITIONS[(stage, status, event)] = (new_stage, new_status, allowed_roles)` | One table decides every move. Anything not in it is refused (409); the wrong role is refused (403). |
| Every move writes a ledger entry, including skipped planned stages | The audit trail shows exactly how a project got where it is. |
| Task board moves have their own small table; tasks stay **Draft** until approval | Done-when for A7. |
| After review: explicit transitions for concurrent runs, plus project row locks | Two tasks running at once can no longer leave the project stage out of sync with its tasks. |

**Learn**
- Finite state machines, a gentle intro: <https://statecharts.dev/what-is-a-state-machine.html>
- `SELECT ... FOR UPDATE` row locks: <https://www.postgresql.org/docs/16/sql-select.html#SQL-FOR-UPDATE-SHARE>

**Check yourself:** a developer calls approve on a project still being evaluated. Which line of code refuses it, and with which HTTP status?

---

## 6. Evaluator: Gemini structured output + verification (`app/ai/`) — A3, B3

| Action | Why |
|---|---|
| `google-genai` SDK with `vertexai=True`, `response_schema=<Pydantic model>` | Gemini must answer in our exact JSON shape; we validate it again with Pydantic. |
| Retries with backoff and a hard timeout per call | A slow model call can never hang a request. |
| **Every epic's `source_quote` must appear in the idea text** (case/whitespace-normalized) | Blocks invented epics. Limit: a real quote does not prove the whole epic follows from it. |
| One repair pass that sends the exact errors back to Gemini | Most bad outputs are fixed on the second try. |
| Memory citations may only use IDs we retrieved; project, PR and verifier come from the DB | The model cannot fabricate a source. |
| Cached fallbacks behind `DEMO_FALLBACK`, labelled "Cached" in the UI | Protects the live demo without misleading anyone. After review: the fallback keeps retrieved memory too. |

**Learn**
- Structured output on Vertex AI: <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output>
- Practical guide to schema adherence: <https://developers.googleblog.com/en/mastering-controlled-generation-with-gemini-15-schema-adherence/>
- Google Gen AI Python SDK: <https://googleapis.github.io/python-genai/>
- Embeddings (`gemini-embedding-001`): <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-text-embeddings>

**Check yourself:** Gemini returns valid JSON with an epic quoting a sentence that is *not* in the idea. Trace what happens next.

---

## 7. Agents: ADK Coder and Reviewer (`app/agents/`) — A8, A10

| Action | Why |
|---|---|
| Coder = ADK `LlmAgent` with exactly 5 tools: `list_files`, `read_file`, `write_file`, `replace_in_file`, `run_tests` | No shell, no network, no git. Every path is checked to stay inside the repo and away from `.git`. |
| `replace_in_file` must match exactly once (added after review) | Small surgical edits instead of rewriting whole files. |
| Tests run with a **scrubbed environment** (added after review) | pytest executes code the agent wrote, so it must not see `GITHUB_TOKEN` or `RUN_TOKEN`. |
| Reviewer = `LlmAgent` with `output_schema=ReviewOutput` | Comments arrive as typed data (path, severity, body), 3 to 5 of them. |
| Runs under an ADK `Runner` with an in-memory session; `max_llm_calls` caps cost | Durable state lives in Cloud SQL, not in the agent. |
| `app/agent.py` exposes `root_agent` | `make playground` (`adk web`) works exactly as in the Agent Starter Pack. |

**Learn**
- ADK overview on Google Cloud: <https://docs.cloud.google.com/agent-builder/agent-development-kit/overview>
- ADK docs (agents, tools, runners, sessions, evaluation): <https://adk.dev/>
- ADK samples to copy patterns from: <https://github.com/google/adk-samples>
- Why agents need guardrails, Anthropic's "Building effective agents": <https://www.anthropic.com/engineering/building-effective-agents>

**Check yourself:** the Coder says "all tests pass", but they don't. Which component's number reaches GitHub, and why?

---

## 8. Worker and runner: Cloud Run Jobs (`app/worker/`, `app/runner/`) — A8, A9

| Action | Why |
|---|---|
| Runner contract from ADR-001: `start / status / cancel / describe` | Local subprocess today, Cloud Run Jobs in production, Agent Substrate or a customer's runner later, with no product code change. |
| One **Cloud Run Job execution per run**, env overrides carry only `RUN_ID`, `RUN_TOKEN`, `CALLBACK_URL` | Isolation, scale to zero, per-run identity. |
| Worker callbacks authenticated by a per-run **HMAC** token | The worker never holds user credentials. |
| ~~The worker pushes and opens the PR~~ **Changed in review round 3:** the worker holds **no GitHub token**. It clones read-only, runs the agent and pytest, and returns a patch. The control plane (`app/publisher.py`) applies the patch to a fresh clone, pushes, opens the PR and sets the `karkhana/tests` status | pytest runs code the agent wrote, so the worker is treated as running untrusted code. A token in its environment could be read by that code (for example via `/proc/<parent>/environ`). Now there is nothing to steal. |
| What untrusted test code can still reach, stated honestly | This run's own callback token (it can only report on this run, no more power than writing a trivially passing test, and humans still triage the PR); the worker service account (Vertex AI user + artifact upload, no DB, no secrets); outbound network. VPC egress controls are on the roadmap. |
| `runs.status` (did the worker finish?) is separate from `runs.validation_status` (did the tests pass?). Failing tests open a **draft** PR, show a red "Validation: failed" banner, and block merge | A failed test can never be mistaken for a successful implementation. |
| `/complete` claims the run with `phase='publishing'` before any network call | Duplicate or late callbacks cannot publish twice. |
| Heartbeats + timeout; late callbacks cannot revive a finished run | Reliability rules from ADR-001. |
| Reviewer retried once; **Retry AI review** endpoint locks the PR row | A reviewer outage can't block a PR forever, and two concurrent retries can't post duplicate reviews (tested with two simultaneous requests). |

**Learn**
- Execute Cloud Run jobs (with overrides): <https://docs.cloud.google.com/run/docs/execute/jobs>
- Invoking jobs with overrides from code: <https://chrlschn.dev/blog/2023/09/programmatically-invoke-cloud-run-jobs-with-overrides>
- HMAC, what and why: <https://en.wikipedia.org/wiki/HMAC>
- GitHub commit statuses API: <https://docs.github.com/en/rest/commits/statuses>
- Fine-grained GitHub tokens: <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>

**Check yourself:** a worker callback arrives twice, the second time claiming tests failed. What does the API do?

---

## 9. Review triage and memory (`app/routers/reviews.py`, `app/memory.py`) — A10, B1, B2, B3

| Action | Why |
|---|---|
| Merge blocked until every AI comment is Valid or Dismissed; dismissing needs a reason (API **and** DB constraint) | The UI greys the button, but the server enforces it. |
| On merge, Gemini distills one learning from the PR and its triage; saved **unverified**, linked to PR and comments | B1. Dismissed comments are never presented as lessons. |
| Only a Lead or Director can verify; who and when are recorded | B2. |
| Retrieval returns only **verified** learnings above a similarity threshold | B3. Unverified agent claims never reach the next project. |

**Learn**
- Retrieval-augmented generation on Google Cloud: <https://docs.cloud.google.com/sql/docs/postgres/ai-overview>
- Cosine similarity, intuitively: <https://www.pinecone.io/learn/vector-similarity/>

**Check yourself:** why is "human verifies before reuse" the most important rule in the memory system?

---

## 10. Frontend (`web/`)

| Action | Why |
|---|---|
| React + TypeScript + Vite, TanStack Query for polling | Small, fast to change; polling fits "browsers poll, nothing depends on a live stream" (ADR-001). |
| Firebase Web SDK sign-in; dev mode has role buttons | Same server-side role checks either way. |
| Ledger panel on every screen, stage tracker, trust badges by shape (not color) | A5, A6, B4. Readable in black and white and for color-blind viewers. |

**Learn:** React docs <https://react.dev/learn> · TanStack Query <https://tanstack.com/query/latest> · Firebase Auth for web <https://firebase.google.com/docs/auth/web/start>

---

## 11. Deploy: one config (`Dockerfile`, `cloudbuild.yaml`, `infra/bootstrap.sh`) — A11

| Action | Why |
|---|---|
| One image, three roles (API, worker Job, migrate Job), non-root user | One build, consistent code everywhere. |
| `bootstrap.sh`: project, billing link, budget alert, APIs, Artifact Registry, 3 service accounts, Cloud SQL with IAM auth, Secret Manager, bucket. Idempotent | Fresh project to deployable in one command, safe to re-run. |
| `cloudbuild.yaml`: build → push → migrate+seed Job → deploy API → deploy worker Job | Done-when for A11: a fresh deploy works from one Cloud Build config. |
| Secrets only via `--set-secrets` from Secret Manager | Nothing sensitive in the image or the repo. |

**Learn**
- Cloud Build config reference: <https://docs.cloud.google.com/build/docs/build-config-file-schema>
- Cloud Run service identity (least privilege): <https://docs.cloud.google.com/run/docs/securing/service-identity>
- Secret Manager with Cloud Run: <https://docs.cloud.google.com/run/docs/configuring/services/secrets>
- Billing budgets and alerts: <https://docs.cloud.google.com/billing/docs/how-to/budgets>

**Check yourself:** which service account can read the GitHub token, and which one deliberately has no database access?

---

## 12. Verification record

Every result below says **when, where and how** it was produced. Older rows are kept
for history and marked as such; they are not re-claimed for the current code.

### Current (Thu 15 Oct 2026, ~01:40 IST, after review round 3)

| Check | Environment | Command | Result |
|---|---|---|---|
| Lint | Linux sandbox, Python 3.13, uv | `uv run ruff check app` · `ruff format --check app tests` | Clean |
| Unit + integration tests | Same, **PostgreSQL 16.15 + pgvector** local, least-privilege app role | `uv run pytest -q -rs` | **46 passed, 0 skipped** |
| Frontend | Node 22 | `npm ci && npx tsc -b && npm run build && npm audit` | Builds; **0 vulnerabilities** |
| Browser golden path | Same sandbox, real server + real worker subprocess + local git remote, Chromium 141, `DEMO_FALLBACK=true` | `npm test` in `tests/e2e` | Full flow passed in 22 s: 403 for non-Director approve, agent run **19 tests passed, exit 0**, "Worker: succeeded / Validation: passed", branch pushed **by the control plane** (worker had no token), triage → merge → verify, ledger 23 entries verified. Only B3 not shown (needs Vertex AI embeddings). |
| Not run here | — | — | Docker build (no Docker), Cloud Run, live Gemini, Firebase sign-in, real GitHub PR (no credentials). CI (`.github/workflows/ci.yml`) covers the Docker build once the repo is on GitHub. |

### Earlier runs (historical, for the code at that time)

| When | Environment | Result |
|---|---|---|
| Thu 00:44 IST | Linux sandbox + Postgres | 37 passed; browser golden path passed (agent run: 19 tests passed, exit 0; ledger 23 entries verified). B3 showed "no relevant memory" because embeddings need Vertex AI. |
| Thu ~00:56 IST | **Windows (teammate's machine)**, no PostgreSQL | 26 passed, 8 skipped (DB), 3 failed: Windows paths and `WinError 10106`. Both fixed. |
| Thu ~01:05 IST | **Windows (teammate's machine)**, no PostgreSQL | 31 passed, 8 skipped (DB tests skip without PostgreSQL by design). API boot + `/healthz` OK; frontend build OK. |

**Skipped-test policy:** integration tests skip only when PostgreSQL is unreachable. CI
fails the build if anything is skipped, so a green CI always means the database tests ran.

## Suggested learning order for the team (about 3 hours total)

1. ADK quickstart, then `make playground` on the demo repo (45 min). Most important for the agent track.
2. Gemini structured output doc + `app/ai/evaluator.py` (30 min).
3. Cloud Run jobs + `app/runner/cloudrun_job.py` (20 min).
4. IAM database auth + `app/db.py` (20 min).
5. Read `tests/integration/test_golden_path.py` top to bottom (30 min). It is the whole product as one story.
6. pgvector README + `app/memory.py` (20 min).
