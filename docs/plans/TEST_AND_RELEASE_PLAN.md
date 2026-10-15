# Test and release plan

> **Blueprint alignment:** this plan implements Blueprint §19 (testing strategy and definition of done). All 9 test layers from the Blueprint are covered; v2.0 implements layers 1-5; layers 6-9 are scheduled below.

## Fix first (blocks the suite)

- `tests/fakes.py`, `tests/unit/test_evaluator.py`, `tests/integration/test_golden_path.py`, `tests/integration/test_ledger_and_worker.py`: replace `app.ai.fallbacks` and `genai` with `tests.fixtures` and the `llm` facade; delete the tests for cached fallbacks and `served_from_cache`.
- `tests/conftest.py`: drop `DEMO_FALLBACK`.
- `tests/e2e/golden.js`: read `tests/fixtures/demo_ideas.json`.
- `Makefile`: `dev` target without `DEMO_FALLBACK`; remove `deploy-demo`.
- `cloudbuild.yaml`: remove `_DEMO_FALLBACK`; add `GEMINI_API_KEY` secret and provider env.

## Test layers (Blueprint §19)

### Layer 1 — Unit tests (domain rules, policies, scoring, transitions)
- Ollama provider: structured output, embed task prefixes, health, error mapping (mocked HTTP transport).
- `llm` facade: provider switch, model names.
- Memory: retrieval filters on `embedding_model`.
- Review: `parse_review` cases, subprocess failure modes, `reviewed_at` merge-blocker logic, retry endpoint 409.
- Onboarding: org create, invite, accept, role set server-side, 403 `onboarding_required`.
- Dashboard / nav: each role gets only its sections and pages.
- Context: write, search, file + DB consistency, agent-written entries start unverified.
- Model usage: budget enforcement, circuit breaker.
- Audit events: every state-change route writes a row with correct actor and org.

### Layer 2 — Contract tests (provider/integration adapters — Blueprint §19)
- AX: manifest generation, axcheck accept/reject, `ax get` parsing, missing CLI.
- GitHub adapter: webhook signature validation, PR create, status push, HMAC callback.
- Gemini adapter: chat, embed, error mapping, timeout.
- Ollama adapter: chat, embed, model-list, unreachable host.
- PR-Agent adapter: zero-issues result, severity inference, subprocess timeout, non-zero exit.

### Layer 3 — Database integration tests (migrations and tenant isolation)
- Migrations 001–004 apply on a fresh DB and on an existing DB; grants correct.
- Cross-tenant suite: org A creates every object type, org B gets 404 on each read, write and list endpoint. Runs in CI; blocks merge.
- Vector search filtered by `org_id` first; no cross-tenant embedding leakage.
- Ledger hash chain per org: append, verify, tamper detection.
- Row-level security: direct SQL as `karkhana_app` role cannot see another org's rows.

### Layer 4 — Workflow tests (success, failure, retry, timeout, cancellation, manual bypass)
- Run start → worker callback → PR published → review posted → triage → merge → learning saved.
- Worker timeout → `timed_out` status → retryable stage.
- Re-delivered `/complete` callback is idempotent (does not open a second PR).
- Cancel in-flight run: status transitions correctly, no orphaned resources.
- Manual coding path: task completed without an agent run.

### Layer 5 — End-to-end tests (idea → approval → project → task → run → verification → release evidence)
- Playwright golden path: onboarding → create project → create task → start run → triage PR → merge → verify ledger.
- Runner honest state: no cluster → UI shows "AX not connected", run start blocked.
- Provider honest state: model down → app stays usable for reading and triage; evaluation shows "unavailable".

### Layer 6 — Security tests (Blueprint §19 — required before launch)
Tests live in `tests/security/`:
- Cross-tenant access: every endpoint returns 404 for org B's resources when called as org A.
- Role escalation: user cannot grant themselves a higher role; invitation role is server-side only.
- Invitation misuse: expired token rejected; wrong email rejected; second-use rejected.
- Forged callback: HMAC mismatch on `/complete` returns 403; out-of-order completion rejected.
- Prompt injection: repo content with injected instructions does not steer tool calls or expose other-org context.
- Oversized input: fields obey Pydantic limits; no 500 on max-size payload.
- Route coverage: an enumeration test asserts every route in `app/fast_api_app.py` has a `require_role` check.
- Secret leakage: CI gitleaks scan; log redaction verified; PR body and test output scrubbed for key patterns.
- SSRF: outbound HTTP from workers is restricted to the allow-list; an SSRF payload in a task gets blocked.

### Layer 7 — Visual regression tests (Blueprint §19)
- Playwright screenshots at 1440px and 390px for: landing, sign-in, onboarding, each role dashboard, project detail, run detail, PR triage, context explorer, ledger, settings, audit log.
- Screenshot diff baseline stored in `tests/visual/`.
- CI runs visual regression and flags diffs > threshold for human review.

### Layer 8 — Load tests (Blueprint §19)
- Tool: `locust` or `k6` in `tests/load/`.
- Targets (from Production Readiness §7):
  - API p95 ≤ 300 ms for non-model endpoints at 3x expected concurrent users.
  - Portfolio queries under load.
  - Event processing and context retrieval throughput.
  - Worker concurrency: N simultaneous runs do not interfere.
- Run before each release candidate; block launch if targets missed.

### Layer 9 — Restore and disaster recovery tests (Blueprint §19)
- Restore drill: restore staging DB from backup into a scratch instance; run ledger verify; pass ledger verify.
- Rollback drill: deploy a known-good revision to staging; smoke tests pass; service recovers.
- Run quarterly and before any major schema migration.

## New tests (v2.0 focus)

| Area | Tests |
|---|---|
| Ollama provider | structured output, embed task prefixes, health, error mapping (mocked HTTP transport) |
| `llm` facade | provider switch, model names |
| Memory | retrieval filters on `embedding_model` |
| Review | `parse_review` cases, subprocess failure modes, `reviewed_at` merge-blocker logic, retry endpoint 409 |
| AX | manifest generation, axcheck accept/reject, `ax get` parsing, missing CLI |
| Onboarding | org create, invite, accept, role set server-side, 403 `onboarding_required` |
| Dashboard / nav | each role gets only its sections and pages |
| Context | write, search, file + DB consistency, agent-written entries start unverified |
| Audit events | every consequential state change writes a correct row |
| Model usage | budget check before dispatch; budget-exceeded error |
| Security (layer 6) | cross-tenant, role-escalation, invitation misuse, forged callback, route-coverage |

## Live verification (real services, no stubs)

1. Local Postgres with migrations 001-004 applied as owner, app as `karkhana_app`.
2. Ollama: evaluator on `qwen2.5-coder:14b`, embeddings on `nomic-embed-text`, one learning stored and retrieved.
3. A real run with the local runner against a local git remote: tests run, patch published, PR-Agent review recorded.
4. Gemini path with a real key when one is available.
5. Playwright pass through onboarding, approval, run, triage, merge, ledger verify.

## Definition of done (Blueprint §19)

A change is done when every line is true:
- Acceptance criteria mapped to tests or explicit human evidence.
- No unexplained failing checks.
- Required review and approvals complete.
- Security/license/dependency checks recorded.
- Audit and trace correlation works end-to-end.
- Permission boundaries verified (cross-tenant test).
- Loading, empty, error, retry and reduced-motion states implemented.
- Responsive (1440px, 1024px, 768px, 390px) and keyboard-accessible.
- Docs, runbook, metrics and owner updated.
- Integration status accurately reflects real configuration and health.
- No secrets in code, logs, PR bodies or screenshots.
- Migration is forward-only and idempotent.

## Release checklist

- [ ] `uv run pytest`, `ruff check`, `ruff format --check`, `codespell`
- [ ] `cd web && npx tsc -b && npm run build`
- [ ] Grep: no `fallbacks`, `DEMO_FALLBACK`, `served_from_cache`, no non-Gemini/Ollama vendor names
- [ ] `THIRD_PARTY_NOTICES.md` matches `third_party/`
- [ ] Layer 6 security tests pass
- [ ] Layer 7 visual regression baseline updated and diff reviewed
- [ ] README, BUILD_LOG, GO_LIVE, LOCAL docs updated for the Ollama/Gemini setup and the AX runner
- [ ] `.gitignore`: `.venv-pr-agent/`, `third_party` build output
- [ ] Commit on `feat/factory-v2`, open PR
