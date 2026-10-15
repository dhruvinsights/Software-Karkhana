# Work breakdown, acceptance and launch gates

> **Blueprint alignment:** this plan implements Blueprint §18 (delivery roadmap, Tracks A + D) and §22 (immediate next actions). Blueprint Tracks B (discovery), C (design/plan), E (QA/security/ship) and F (context/scale) are explicitly tracked but not in scope for v2.0.

Every item has an ID, an owner role, a done-when statement and a dependency. Dates are relative to the start of phase 1. Owners are roles: BE backend, FE frontend, INF infrastructure, SEC security, QA, PM product.

## Work breakdown

| ID | Work | Owner | Done when | Needs | Est. |
|---|---|---|---|---|---|
| P1-1 | Migration `004` (embedding_model, review columns, drop served_from_cache, new tables: organizations, memberships, invitations, onboarding_state, context_entries, model_usage, audit_events) | BE | Applies on a fresh and an existing DB; ORM matches; grants updated | none | 0.5 d |
| P1-2 | Remove stale fallback references from tests, Makefile, cloudbuild, docs, `check_models.py` | BE | `grep -ri "fallbacks\|DEMO_FALLBACK\|served_from_cache"` returns nothing outside history; `pytest` and `ruff` green | P1-1 | 1 d |
| P2-1 | Orgs, memberships, invitations, onboarding state tables and API | BE | Plan tests pass; role set server-side only | P1-1 | 3 d |
| P2-2 | Tenant isolation: scoping helper, RLS, per-org ledger chain | BE, SEC | Cross-tenant suite green on every endpoint | P2-1 | 4 d |
| P2-3 | `/api/nav`, `/api/dashboard`, `/api/providers/health`, `/api/runner/status`, `/api/public/stats` | BE | Each role receives only its sections; values come from SQL | P2-1 | 2 d |
| P2-4 | Audit events: `audit_events` table; every state-change route writes a row with actor, org, correlation_id | BE | Enumeration test confirms every state-change route writes an audit row | P1-1 | 1 d |
| P2-5 | Model usage metering: `model_usage` table, per-org budget check, circuit breaker | BE | Budget check tested; over-budget returns a clear error; usage shown in settings | P2-1 | 2 d |
| P3-1 | AX runner backend with `axcheck` validation | BE | Manifest tests pass; against a real cluster one task runs and calls back; without a cluster it reports a clear error | none | 3 d |
| P3-2 | PR-Agent engine tests and config docs | BE | Parse and failure-mode tests green; one live review with Ollama and one with Gemini recorded | P1-2 | 1.5 d |
| P3-3 | Shared context store, API (search, write, verify, pack), agent read/write, optional MCP endpoint | BE | Entries round-trip file and DB; evaluator and Coder prompts cite entry ids in the ledger; stale entries visibly labelled | P2-1 | 4 d |
| P3-4 | ADK worker adapter pilot: wrap ADK Agent in BaseWorker; stream ADK events as RunEvent rows | BE | One task completes end-to-end using the ADK adapter; Karkhana state machine remains outside ADK objects | P3-1 | 3 d |
| P4-1 | Design tokens, base components, shell, auth | FE | One palette; sidebar built from `/api/nav` | P2-3 | 3 d |
| P4-2 | Onboarding flow (Blueprint §4.3: Slack-like progression) | FE | New user completes create-org and invite on the real API; empty state correct | P2-1, P4-1 | 3 d |
| P4-3 | Four role dashboards | FE | Each shows live data with loading, empty and error states | P2-3 | 4 d |
| P4-4 | Projects, project detail, run, PR triage, learnings, context, team, ledger, settings, audit log pages (v2 screens) | FE | Full golden path works in the browser | P3-*, P4-1 | 7 d |
| P4-5 | Landing page (taste-skill rules, Blueprint §4.1) | FE | Passes the copy self-audit and Playwright screenshots; real stats only; no fake logos | P2-3 | 3 d |
| P5-1 | Dockerfile, Terraform, secrets, cloudbuild, migrate job | INF | Fresh project deploys from scratch with one command | P1-2 | 4 d |
| P5-2 | CI pipeline with all gates (lint, type, test, security scan, SBOM, license check) | INF | Required checks on `main`; failing check blocks merge | P1-2 | 2 d |
| P5-3 | Observability, alerts, dashboards, runbooks (API health, runs/models, cost, AI quality) | INF | Every alert fires in a staged drill | P5-1 | 4 d |
| P5-4 | Security controls and tests (rate limits, headers, route-coverage test, ABAC, egress, prompt injection, SSRF) | SEC, BE | `tests/security` green; pen-test findings closed | P2-2 | 5 d |
| P5-5 | Backups, restore drill, rollback drill | INF | Restore into scratch DB passes ledger verify | P5-1 | 1.5 d |
| P5-6 | Billing, legal pages, data export/deletion (if multi-customer) | PM, BE, FE | Legal approved; export and deletion tested | P2-2 | 5 d |
| P6-1 | Load test and performance tuning | QA, BE | Targets from the readiness plan met at 3x expected load | P4-4, P5-1 | 2 d |
| P6-2 | Full QA pass, accessibility audit, cross-browser/mobile | QA | No open P0/P1 bugs; WCAG 2.2 AA on core flows | P4-* | 4 d |
| P6-3 | Beta with 2-3 real teams | PM | Two weeks, feedback triaged, no data-isolation or data-loss incidents | P6-2 | 14 d |

Critical path: P1 → P2-1 → P2-2 → P4-* → P6. Phases 3 and 5 run in parallel with phase 4. With two backend, two frontend and one infrastructure engineer this is roughly 8 weeks to beta start plus the 2-week beta.

## Per-phase exit criteria (Blueprint §18 Track exit criteria)

- **Phase 1**: tests and lint green on the branch; no references to removed fallbacks.
- **Phase 2**: a new user can create an org, invite a teammate and each sees only their role's pages; cross-tenant suite green; every state-change route writes an audit event.
- **Phase 3**: a task runs end to end on the local runner and on Cloud Run Jobs; PR-Agent review posted; a context entry written by an agent is retrieved in a later evaluation; ADK adapter pilot completed.
- **Phase 4**: the complete flow task → run → PR → triage → merge → learning works in the browser with only real data; no `mock`, `faker`, `lorem` or other vendors' names in `web/src`.
- **Phase 5**: staging deploys from CI; restore and rollback drills done; alerts proven; security tests green; SBOM generated.
- **Phase 6**: beta exit review.

Track exit criteria checklist (Blueprint §18, applies to every track):
- [ ] No critical authorization or tenant-isolation defects.
- [ ] End-to-end integration test on real services, plus a clear test adapter.
- [ ] Migrations, rollback and operational runbook.
- [ ] Logs/traces/metrics and audit events.
- [ ] Accessibility and responsive checks for user-facing changes.
- [ ] No fake success state; failure, retry and recovery are tested.
- [ ] Documentation, license inventory and owner are recorded.

## Go / no-go launch gate

Launch only if every line is true:

- [ ] All P-items above are done-when satisfied
- [ ] Cross-tenant, role-escalation and forged-callback tests green in CI
- [ ] External or independent security review done, no open high findings
- [ ] Restore drill and rollback drill completed in the last 30 days
- [ ] On-call rota and runbooks in place; one incident drill held
- [ ] Gemini production key, budgets and alerts configured
- [ ] Legal pages live and data export/deletion working (if multi-customer)
- [ ] Beta feedback reviewed; no P0/P1 open
- [ ] `THIRD_PARTY_NOTICES.md` current and license check clean
- [ ] Status page and support channel live
- [ ] SBOM generated and stored with release artifact
- [ ] AI quality metrics dashboard operational

## Definition of done for any change

Code reviewed; tests added and green; lint and type checks clean; docs and runbooks updated; migration is forward-only and idempotent; no secrets; audit event written for any state change; UI has loading, empty and error states.

## Open decisions to resolve before production (Blueprint §21)

1. Tenant isolation model: pooled first with strict RLS and storage namespaces, or cell-based from the first deployment?
2. Initial auth: Google sign-in only for first release, with enterprise federation interface prepared?
3. First coding worker: ADK-managed tools, Scion adapter, Gemini CLI, or a small owned runner?
4. Which repository host is the first fully supported adapter?
5. Is native work tracking canonical, or is an external tracker allowed to own tasks for selected projects?
6. Context retention and org-memory approval roles.
7. Data residency and provider data-retention requirements.
8. Production deployment policy and required sign-off quorum.
9. Supported initial language/framework matrix.
10. Which design tool integrations have usable APIs and approved credentials at implementation time?
11. AI data handling: which Gemini/Vertex enterprise data handling agreements apply?
12. SBOM format: CycloneDX or SPDX?

Record decisions as ADRs with alternatives, evidence, trade-offs, owner and review date.

## Not in scope for v2.0 (Blueprint Tracks B, C, E, F — tracked, not forgotten)

| Feature area | Blueprint track | Blueprint sections |
|---|---|---|
| Product/idea discovery, multi-agent evaluation, approval routing | B | §12, §3 |
| Product context, idea brainstorm, validation studio, evaluation report | B | §4.5, §12 |
| Design/prototype workspace, architecture ADRs, diagrams, API contracts | C | §12 |
| Epic/story planning, dependency graph, workflow designer, roadmap | C | §12, §7 |
| Role expansion: designer, architect, QA, security, devops, release manager, SRE | C/E | §6 |
| QA test plans, manual/automated execution, defects, flaky tracking | E | §12 |
| Security findings, waiver workflow, pen-test import, SBOM viewer | E | §12, §15 |
| CI/CD pipeline integration, environment catalog, release management | E | §12 |
| Production health, incidents, postmortem | E | §12 |
| Live shared context streaming (Pub/Sub), memory promotion (project → team → org) | F | §8, §13 |
| Portfolio views, BigQuery analytics, cost/evaluation dashboards | F | §16 |
| Scion/Agent Substrate/AX hosted cluster experiments | F | §10 |
| Customer-hosted runner, cell isolation, data residency controls | F | §13, §15 |
| Feedback triage, support signals | F | §12 |
| SSO (SAML/OIDC) | follow-up | §15 |
| Hosted AX cluster, marketplace listing, mobile app | follow-up | — |
