# Team plan — v2 build (`feat/factory-v2`)

> **v2 update:** the hackathon sprint is over. This plan tracks the v2 production rebuild. See [V2_PLAN.md](V2_PLAN.md) for the master plan and [docs/plans/ACCEPTANCE_AND_LAUNCH_PLAN.md](plans/ACCEPTANCE_AND_LAUNCH_PLAN.md) for the full work breakdown with IDs, owners, done-when criteria and the go/no-go launch gate.

---

## Phase ownership

| Phase | Owner(s) | Work items | Done when |
|---|---|---|---|
| **P1 — Unblock backend** | BE | P1-1 (migration 004), P1-2 (remove fallback refs) | `pytest` and `ruff` green; no `fallbacks`/`DEMO_FALLBACK`/`served_from_cache` references |
| **P2 — Identity & onboarding** | BE, SEC | P2-1 (org/membership/invitation API), P2-2 (tenant isolation + RLS), P2-3 (nav/dashboard/health APIs), P2-4 (audit events), P2-5 (model usage metering) | New user can create org, invite teammate; each sees only their role's pages; cross-tenant suite green |
| **P3 — Integrations** | BE | P3-1 (AX runner + axcheck), P3-2 (PR-Agent tests), P3-3 (shared context store + API + MCP), P3-4 (ADK worker adapter pilot) | Task runs end-to-end; PR-Agent review posted; context entry written by agent retrieved in next evaluation; ADK adapter completes one task |
| **P4 — UI rebuild** | FE | P4-1 (tokens/components/shell), P4-2 (onboarding), P4-3 (dashboards), P4-4 (project/run/PR/context pages), P4-5 (landing) | Full golden path in browser; no `mock`/`faker`/`lorem` in `web/src`; Blueprint §4.6 empty states correct |
| **P5 — Hardening** | INF, SEC | P5-1 (Dockerfile/Terraform/cloudbuild), P5-2 (CI pipeline), P5-3 (observability/runbooks), P5-4 (security tests), P5-5 (backup/restore drill), P5-6 (billing/legal if multi-customer) | Staging deploys from CI; all drills done; security tests green; SBOM generated |
| **P6 — Beta** | QA, PM | P6-1 (load test), P6-2 (full QA/accessibility), P6-3 (2-week beta with real teams) | No P0/P1 open; WCAG 2.2 AA on core flows; beta exit review passed |

Critical path: P1 → P2 → P4 → P6. Phases P3 and P5 run in parallel with P4.

---

## Sprint rules

- `main` must always deploy. Small PRs, `make test` green before merge.
- No hardcoded data in `web/src`. If a page needs data, add the API endpoint first.
- Any change to a gate, role check or the ledger needs a test in `tests/integration`.
- Any change to an auth or tenant-isolation path needs a test in `tests/security`.
- No `DEMO_FALLBACK`, no `served_from_cache`. If the model is unavailable, return an honest error.
- Provider labels in the UI must come from the DB (`review_engine`, `review_model` on the PR record). Never hardcode.

---

## Per-role work focus

| Role | Primary focus during build |
|---|---|
| Backend engineer 1 | P1, P2-1, P2-2, P2-4 — migration, org/invitation API, tenant isolation |
| Backend engineer 2 | P2-3, P2-5, P3-1 through P3-4 — APIs, AX runner, shared context, ADK adapter |
| Frontend engineer 1 | P4-1, P4-2, P4-3 — tokens, onboarding, dashboards |
| Frontend engineer 2 | P4-4, P4-5 — project/run/PR/context pages, landing page |
| Infrastructure | P5-1 through P5-5 — Dockerfile, Terraform, CI, observability, drills |
| Security / QA | P5-4, P6-1, P6-2 — security tests, load test, full QA pass |

---

## Original hackathon sprint (Wed 21:30 to Fri 12:00 freeze) — historical

The hackathon delivered Tier A + B features on the original Python stack. The v2 rebuild starts from that foundation and adds multi-org tenancy, Ollama provider, review engine, shared context, full onboarding UI and production hardening.

| Track | Owner | Delivered |
|---|---|---|
| Infra and deploy | Person 1 | Public Cloud Run URL, Google sign-in, live Gemini evaluation |
| Evaluator quality | Person 2 | Source-quote grounding, real Gemini calls |
| Coder and Reviewer agents | Person 3 | ADK Coder + Reviewer, Cloud Run Job worker |
| Frontend and UX | Person 4 | Role-scoped UI, ledger panel, stage tracker |
| Story, deck, video | Person 5 | Demo script, presentation, golden path |
