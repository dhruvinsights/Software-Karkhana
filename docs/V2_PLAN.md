# Software Karkhana v2: master plan

Branch: `feat/factory-v2`. Goal: a production-ready software factory.

**Product thesis (from Blueprint):** Software Karkhana is an executable software factory—not a chat wrapper, not a single coding agent, and not a dashboard full of disconnected mock screens. It coordinates intent, planning, people, agent workers, repository changes, verification, human decisions, release and learning through one evidence-backed lifecycle.

The v2 delivery slice covers Tracks A + D from the Blueprint (see §18): foundation, identity, onboarding, tenant isolation, agent execution, PR review, shared context and the corresponding UI. Tracks B (discovery), C (design/plan), E (QA/security/ship) and F (context/scale) are explicitly tracked but not built in this release.

Idea → AI evaluation → director approval → AI agent writes code → real GitHub PR → AI review + human triage → learnings reused.

Rules for this build: no mocks, no hardcoded frontend data, one theme everywhere, Gemini + Ollama only, reuse permissively licensed open source instead of rewriting it, Google-first production stack.

Detailed plans: [UI](plans/UI_PLAN.md) | [Backend, roles and onboarding](plans/BACKEND_PLAN.md) | [Runner, review and context](plans/INTEGRATIONS_PLAN.md) | [Test and release](plans/TEST_AND_RELEASE_PLAN.md)

Shipping plans: [Production readiness](plans/PRODUCTION_READINESS_PLAN.md) (tenancy, deployment, model hosting, CI/CD, product basics) | [Security](plans/SECURITY_PLAN.md) | [Operations](plans/OPERATIONS_PLAN.md) | [Work breakdown, acceptance and launch gates](plans/ACCEPTANCE_AND_LAUNCH_PLAN.md)

Start with the work breakdown: it assigns IDs, owners and "done when" criteria to everything above, and ends with the go/no-go launch gate.

## Status

| Area | State |
|---|---|
| Vendored OSS (`third_party/`: ax, pr-agent, TeamContext, substrate docs) | Done |
| `tools/axcheck` (AX manifest validator, Go) | Done |
| Provider layer: Gemini + Ollama (`nomic-embed-text` embeddings) | Done |
| Removed fallbacks, `DEMO_FALLBACK`, cached evaluations | Done in `app/`; tests, Makefile, cloudbuild, docs still reference them |
| Review engine (`app/review/`: PR-Agent or ADK), clean-review state | Done in code; needs migration 004 |
| Migration 004 | **Not started (blocks everything on Postgres)** |
| Onboarding, orgs, invitations, role-scoped APIs | Not started |
| AX runner backend | Not started (needs a Kubernetes cluster to run) |
| Shared context | Not started |
| New UI | Not started |
| Docs, tests, commit | Not started |

## Product hierarchy (Blueprint §3)

The full entity tree Karkhana models (v2 builds the foundation; upper layers are future tracks):

```
Organization → Workspace → Product → Idea → Project
                                           → Epics → Stories → Tasks → AgentRuns
```

Core entities for v2.0: `User`, `Organization`, `Membership`, `Invitation`, `Project`, `Task`, `AgentRun`, `WorkerLease`, `RunEvent`, `PullRequest`, `ReviewFinding`, `ContextItem`, `ContextLink`, `Evidence`, `AuditEvent`.

Future (tracked, not v2.0): `Product`, `ProductContextVersion`, `Idea`, `EvaluationRun`, `WorkflowBlueprint`, `WorkflowInstance`, `Gate`, `GateDecision`, `Epic`, `Story`, `DesignArtifact`, `ArchitectureDocument`, `ADR`, `TestPlan`, `SecurityFinding`, `Release`, `Deployment`, `MemoryPromotion`.

## Lifecycle workflow (Blueprint §7, scoped to v2)

```
Task created
  → context assembled (project context + shared context)
  → isolated worker execution OR manual work
  → validation + evidence
  → PR and AI-assisted review
  → human triage and merge decision
  → verified learning saved to context store
```

Full lifecycle (discovery → design → QA → security → deploy → feedback) is in the Blueprint; later tracks implement each stage.

## Autonomy modes supported in v2 (Blueprint §7)

- **Manual:** people perform the work; Karkhana stores context and evidence.
- **Automated:** pre-authorized agent runs within budgets, scopes and verification rules.
- **Approval-required:** agent prepares a consequential action; an authorized person approves before merge.

## Phases (in order)

1. **Unblock the backend** (day 1)
   - Write `db/migrations/004_v2.sql` and the grants.
   - Fix stale `app.ai.fallbacks` references in `tests/`, `tests/e2e/golden.js`, `Makefile`, `cloudbuild.yaml`, `check_models.py`.
   - Exit: `pytest` and `ruff` are green again.
2. **Identity and onboarding** (day 2-3): see BACKEND_PLAN.
3. **Integrations** (day 3-5): AX runner, PR-Agent engine tests, shared context. See INTEGRATIONS_PLAN.
4. **UI rebuild** (day 4-8): see UI_PLAN. Starts once the APIs in phase 2 exist, so no page needs fake data.
5. **Hardening and release** (day 8-10): see TEST_AND_RELEASE_PLAN.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Repo | Rebuild `web/` in place on `feat/factory-v2` | The existing app already talks to the real API |
| `software-karkhana_latest/` (AI Studio zip) | Reference for screens and IA only | It is all mock data |
| LLM providers | `gemini` and `ollama`, chosen by `LLM_PROVIDER` / `EMBED_PROVIDER` | User requirement; nothing else integrated |
| Production model | Gemini through Vertex AI; Ollama only for local dev | Blueprint §10.2 — Google-first production baseline |
| Embeddings | `nomic-embed-text`, 768-d, stored per `embedding_model` | Matches the pgvector column, no schema change |
| PR reviewer | PR-Agent (MIT) in plain-diff mode, isolated venv | Real OSS reviewer, no GitHub token in the worker |
| Sandbox runner | google/ax via `RUNNER_BACKEND=ax` | User requirement; honest status when no cluster |
| Shared context | TeamContext (Apache-2.0) vendored; project-context, shared-context-mcp and shared-brain used as ideas only | Their licenses forbid or do not grant copying |
| Palette | One dark navy/blue palette from the Hubfolio reference with Material 3 spacing | One consistent theme, including onboarding |
| Agent framework | ADK piloted as primary agent framework | Blueprint §10.1 — ADK is the primary agent framework candidate |
| Cloud platform | Google Cloud (Cloud Run + Cloud SQL + Firebase Auth) | Blueprint §10.2 — Google-first production baseline |
| Service architecture | Modular monolith first | Blueprint §13 — separate microservices only when evidence requires it |

## OSS candidates for v2 (Blueprint §10.1)

| Candidate | v2 role | Status |
|---|---|---|
| Google ADK Python | Agent framework (pilot) | Evaluate; ADK behind Karkhana worker abstraction |
| Google AX | Task/sandbox orchestration | Research prototype; `RUNNER_BACKEND=ax` |
| Gemini CLI | Coding agent harness | Supported worker adapter |
| PR-Agent (MIT) | AI code review engine | Vendored; `app/review/` |
| TeamContext (Apache-2.0) | Context layout ideas | Vendored in `third_party/`; not copied |
| Project Context | Repo-local context pipeline | Pilot for Git-tracked context artifacts |
| Ollama | Local dev/test model server | Adapter only; not production default |
| Taste Skill | Landing page art direction | After license review |

## Risks

- AX needs Kubernetes, Agent Substrate, `kubectl` and `ko`. None are on this machine. The UI must show "no cluster connected" instead of faking runs.
- PR-Agent on a local 14B model takes about 100 s per review and may return zero issues. The adapter treats that as a valid clean review.
- Switching embedding models makes old vectors unusable. Retrieval already filters on `embedding_model`.
- Adding roles touches the DB CHECK, the `Role` enum and `process.py` transitions together.
- ADK is a pilot; if the framework API is incompatible, Karkhana owns the worker abstraction and can swap the implementation.
- Google dependency: provider abstractions, portable artifacts, standard protocols and tested fallbacks mitigate this (Blueprint §20).

## Not in scope for v2.0 (Blueprint Tracks B, C, E, F)

Product/idea discovery, multi-agent evaluation, approval routing, design/prototype workspace, architecture ADRs, epic/story planning, QA test plans, security scan/waiver workflow, CI/CD pipeline integration, release management, portfolio views, BigQuery analytics, SSO (SAML/OIDC), additional roles (designer, architect, QA, security, devops, release), hosted AX cluster, Scion/Agent Substrate experiments, customer-hosted runner, marketplace listing, mobile app.

All are tracked in ACCEPTANCE_AND_LAUNCH_PLAN.md §"Not in scope for v2.0".
