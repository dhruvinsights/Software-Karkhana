# Backend, roles and onboarding plan

> **Blueprint alignment:** this plan implements Blueprint §3 (core entities for v2), §4 (onboarding), §6 (role workspaces), §8 (shared context), §9 (agent orchestration) and §13 (data service architecture). Higher-level entities (Product, Idea, WorkflowBlueprint, Gate, ADR, TestPlan, Release) are future tracks tracked in ACCEPTANCE_AND_LAUNCH_PLAN.md.

## 1. Migration 004 (`db/migrations/004_v2.sql`)

- `learnings.embedding_model text` (the ORM and `app/memory.py` already use it).
- `pull_requests`: `reviewed_at timestamptz`, `review_engine text`, `review_model text`, `review_summary text` (the ORM already uses them).
- Drop `evaluations.served_from_cache`.
- New tables:
  - `organizations(id, name, slug unique, created_by, created_at)`
  - `memberships(org_id, user_id, role, created_at)`, unique on org + user
  - `invitations(id, org_id, email, role, token_hash, invited_by, expires_at, accepted_at)`
    - Token: 256-bit random, only the hash stored; 7-day expiry; single use; accepting email must match invited email (Blueprint §15, Security Plan).
  - `onboarding_state(user_id, step, completed_at, answers jsonb)`
  - `context_entries(id, org_id, project_id null, kind, title, body, author_id, source, git_path, embedding vector(768), embedding_model, created_at, verified_at, verified_by)`
    - `kind`: `decision | learning | constraint | glossary | state` (aligns with Blueprint §8 context scopes)
    - `source`: `agent | human`; agent-written entries start `verified_at = NULL` — only a lead can mark them verified (Blueprint §8.2)
  - `model_usage(id, org_id, user_id, run_id null, provider, model, prompt_tokens, completion_tokens, cost_usd, created_at)` — per-org usage metering (Blueprint §9, Production Readiness §3)
  - `audit_events(id, org_id, actor_type, actor_id, event_type, entity_type, entity_id, before_state jsonb, after_state jsonb, correlation_id, created_at)` — Blueprint §15 / §13 event envelope; append-only, no DELETE grant
- Add `org_id` to `projects`, `learnings`, `ledger`.
- Extend the grants file for every new table. `invitations` and `context_entries` get SELECT/INSERT/UPDATE; `audit_events` gets SELECT/INSERT only. Nothing gets DELETE except where a table already does.

### Role set for v2.0
Keep `pm | director | developer | lead` for this release. Full Blueprint role set (Blueprint §6) — workspace owner, executive, product manager, designer, architect, engineering lead, senior/junior developer, reviewer, QA tester, test automation engineer, security, devops, release manager, SRE, observer, custom — is a tracked follow-up; adding them requires changing the `users` CHECK, `Role` in `app/process.py` and the TRANSITIONS table together.

### Core event envelope (Blueprint §13)
Every consequential state change emits an audit event with:
```json
{
  "event_id": "uuid",
  "event_type": "task.run.completed",
  "occurred_at": "ISO-8601",
  "org_id": "org",
  "project_id": "project",
  "actor": {"type": "user|agent|system", "id": "id"},
  "correlation_id": "run-id",
  "entity": {"type": "task", "id": "task-id", "version": 7},
  "payload": {},
  "schema_version": 1
}
```
v2.0 writes these as rows in `audit_events`. Future tracks route to Pub/Sub for live event consumers (Blueprint §13).

## 2. Onboarding API (`app/routers/onboarding.py`)

Implements Blueprint §4.3 (Slack-like progression):

| Route | Purpose | Roles |
|---|---|---|
| `POST /api/onboarding/org` | First user creates the organization and becomes director | any signed-in new user |
| `GET /api/onboarding/state` | Current step and answers | self |
| `PUT /api/onboarding/state` | Save a step (profile, role confirmation, provider choice, repo) | self |
| `POST /api/team/invitations` | Invite by email + role | director, lead |
| `POST /api/team/invitations/{token}/accept` | Join with the invited role | invitee |
| `GET /api/team` | Members and pending invites | all roles |

Rules: the role is always set server-side from the invitation or org creation, never from the browser. A user with no membership gets a 403 with an `onboarding_required` code so the UI can route to onboarding.

Onboarding progression (Blueprint §4.3):
1. Sign in with Google / Firebase.
2. Ask workspace/org name.
3. Ask the user's role (personalizes guidance, not authorization).
4. Ask whether to start empty or from a template (empty is the default).
5. Offer invitations now or later.
6. Show a short checklist: connect repository, invite team, configure workflow. Allow skip and resume.
7. Land on a useful empty state with one primary next action.

## 3. Role-scoped dashboards

Blueprint §6: navigation adapts to permission and assignment. Authorization is server-side for every request.

- `GET /api/dashboard` returns the sections for the caller's role only:
  - pm: my ideas, evaluation status, rejected items to resubmit
  - director: items awaiting approval, portfolio, ledger health
  - developer: ready tasks, my runs, PRs with untriaged comments
  - lead: learnings to verify, merge-ready PRs, runner and provider health
- `GET /api/nav` returns the pages the role may open. The sidebar renders only this list.
- Every number comes from SQL over real rows. Empty means empty.
- RBAC + ABAC: org scoping helper (`scoped(query, user)`) used by every router. No router writes its own org filter (Blueprint §15).

## 4. Provider and system health

- `GET /api/providers/health`: Gemini configured (key or ADC), Ollama reachable, model list, embed model present, review engine, PR-Agent venv present.
- `GET /api/runner/status`: backend name, and for `ax` whether `ax` CLI and cluster are reachable. Report the real error text. Honest status: no simulated cluster (Blueprint principle: "No fake integrations").
- `GET /api/public/stats`: real row counts (projects, runs, reviews). Hidden section if no real data.

## 5. Context API (`app/routers/context.py`)

Implements Blueprint §8 (Shared Context). v2 scope: project-level and task-level context.

| Route | Purpose |
|---|---|
| `GET /api/context` | Search entries (semantic + keyword); filters: org, project, kind, verified |
| `POST /api/context` | Write entry; also commits to `.karkhana/context/` in the repo |
| `GET /api/context/{id}` | Single entry with lineage |
| `PUT /api/context/{id}/verify` | Lead marks an agent-written entry as verified |
| `GET /api/context/pack/{task_id}` | Build a bounded task-specific context pack (Blueprint §8.4) |

Context pack builder (Blueprint §8.4):
- Combines authority tier, semantic/lexical relevance, recency, file/task linkage, token budget and permission filtering.
- Output includes source, confidence, `valid_from`, `review_by` and freshness signals.
- Stale entries (past `review_by`) are visibly labelled.

Agents read context: evaluator and Coder prompts include the top-k relevant entries for the project; ledger records which entry IDs were used. Agents write context: merge-time learnings and run summaries are saved as entries with `source=agent`, unverified until a lead verifies them (Blueprint §8.2 promotion rules).

## 6. Model usage metering (`app/routers/usage.py`)

Blueprint §9 (cost/quality controller), Production Readiness §3:
- Every model call writes a row to `model_usage`.
- Per-org daily token budget checked before dispatching; exceeded budget returns a clear error (no silent over-spend).
- `GET /api/usage` returns spend by org and provider for the settings page.
- Alert at 80% of budget; circuit breaker when provider fails repeatedly.

## 7. Cleanup

- `app/scripts/check_models.py`: use the `llm` facade (Gemini or Ollama) instead of direct Vertex calls.
- `seed.py`: `ROLES` read from `app.process.Role`. Users are seeded into a default org.
- `tests/conftest.py`: remove `DEMO_FALLBACK`.

## 8. Future entity work (tracked, not v2.0)

When later tracks are built, these tables and APIs extend the model:

| Entity group | Blueprint section | Track |
|---|---|---|
| `Product`, `ProductContextVersion`, `Idea`, `IdeaEvidence`, `EvaluationRun`, `EvaluationMetric`, `ApprovalRequest`, `ApprovalDecision` | §3, §12 Product and idea discovery | B |
| `WorkflowBlueprint`, `WorkflowInstance`, `WorkflowStage`, `StageTransition`, `Gate`, `GateDecision` | §7, §9 | A/C |
| `Epic`, `Story`, `TaskDependency`, `AcceptanceCriterion` | §12 Project planning | C |
| `DesignArtifact`, `ArchitectureDocument`, `ADR`, `APIContract` | §12 Design and architecture | C |
| `TestPlan`, `TestScenario`, `TestExecution`, `Defect` | §12 QA/QC | E |
| `SecurityFinding`, `SecurityWaiver` | §12 Security | E |
| `ReleaseCandidate`, `Release`, `Deployment`, `RollbackPlan`, `Incident` | §12 DevOps and release | E |
| `MemoryPromotion` (project → team → org context) | §8.2 | F |
| `FeedbackItem` | §12 Feedback and operations | F |
| Pub/Sub outbox for `audit_events` | §13 | F |
