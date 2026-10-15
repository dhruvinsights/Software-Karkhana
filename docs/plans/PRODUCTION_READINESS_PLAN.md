# Production readiness plan

> **Blueprint alignment:** this plan implements Blueprint §13 (data and service architecture), §15 (security, privacy and governance), §16 (observability, evaluation and product metrics) and §18 (delivery roadmap, Track A exit criteria).

Assumptions (change these and the plan changes):
- **Multi-organization product**, not a single-team tool. Single-tenant use is just one organization.
- **Gemini is the production model provider.** Ollama is supported for local development and for customers who self-host a model server.
- **Deploy target: Google Cloud** (Cloud Run + Cloud SQL + Firebase Auth), which is what `cloudbuild.yaml` and `app/db.py` already target.
- **Sandbox execution in production: Cloud Run Jobs first**, `google/ax` when a Kubernetes cluster with Agent Substrate exists.
- **Service architecture: modular monolith first.** Domain APIs in a single deployable; worker execution and event consumers are separate. Split high-load or high-risk domains when evidence requires it (Blueprint §13).

## 1. Tenant isolation (blocker)

Today most endpoints return every row. Before a second organization exists:

| Work | Detail |
|---|---|
| `org_id` everywhere | `projects`, `learnings`, `context_entries`, `ledger`, `approvals`, `runs`, `pull_requests` reach an org through their project; add `org_id` directly to `ledger` and `learnings`. |
| One scoping helper | `scoped(query, user)` used by every router. No router writes its own org filter. |
| Database enforcement | Postgres row-level security on the org-owned tables, with `SET LOCAL app.org_id` per request. Application bugs then cannot leak rows. |
| Ledger | One hash chain per organization (chain key = `org_id`), `verify` runs per org. |
| Memory retrieval | Vector search filtered by `org_id` first. One org's learnings never feed another org's prompts. |
| Tests | A cross-tenant suite: org A creates every object type, org B gets 404 on each read, write and list endpoint. Runs in CI and blocks merge. |

## 2. Deployment

- **Dockerfile**: multi-stage. Stage 1 builds `web/dist`. Stage 2 builds `axcheck` and the `ax` CLI with Go. Stage 3 is a slim Python image with the app, `web/dist`, both Go binaries, and `.venv-pr-agent` built by `scripts/setup_pr_agent.sh`. Run as non-root, read-only root filesystem except `/tmp`.
- **Services**: `karkhana-api` (Cloud Run), `karkhana-worker` (Cloud Run Job), `karkhana-migrate` (Cloud Run Job, owner credentials, runs before each deploy).
- **Secrets** in Secret Manager: `GEMINI_API_KEY`, `RUN_HMAC_SECRET`, `GITHUB_TOKEN`, Firebase web config. No secrets in env files or the image.
- **cloudbuild.yaml**: remove `_DEMO_FALLBACK`; add provider env (`LLM_PROVIDER`, `EMBED_PROVIDER`, `REVIEW_ENGINE`), the secret mounts, a migrate step, a smoke-test step against `/healthz` and `/api/config`, and automatic rollback to the previous revision on smoke failure.
- **Environments**: `dev` (local), `staging` (own project, own database, real Gemini key with a low quota), `prod`. Same image promoted, config differs.
- **Infrastructure as code**: `infra/` Terraform for projects, Cloud SQL, service accounts, Secret Manager, Cloud Run, Artifact Registry, monitoring. No click-ops.
- **Domain and TLS**: custom domain on Cloud Run, HTTPS only, HSTS.

## 3. Model hosting and cost

| Option | Use |
|---|---|
| Gemini (prod default) | API key from Secret Manager. Per-org and global daily token budgets. |
| Ollama | Local development. In production only on a GPU host reachable through a private network (VPC connector), never the public internet. |
| Embeddings | `nomic-embed-text` (Ollama) or Gemini embeddings at 768 dimensions. Each learning stores `embedding_model`; switching providers triggers a background re-embed job instead of silently losing recall. |

Controls: timeouts on every model call, retry with backoff, a per-run token cap, a circuit breaker when the provider fails repeatedly, usage rows per org (`model_usage` table) shown on the Settings page, and an alert at 80% of budget.

## 4. Sandbox execution

- Cloud Run Job worker already holds no GitHub token. Add: egress restricted to the package index, the git host and the model API through a VPC connector and firewall rules; CPU, memory and wall-clock limits; no access to the metadata server credentials beyond artifact upload.
- `ax` backend enabled only when `ax get tasks` succeeds against a real cluster. Until then the UI says "AX not connected" and the option is disabled.
- Per-org limits: concurrent runs, runs per day, maximum repo size.
- Isolated execution requirements (Blueprint §15): CPU/memory/time limits, filesystem boundaries, process limits, no privileged containers, cleanup and artifact scanning.

## 5. CI/CD

GitHub Actions on every PR: `ruff check`, `ruff format --check`, `codespell`, `pytest` with Postgres + pgvector service, `tsc -b`, `vite build`, Playwright smoke, `pip-audit`, `npm audit`, license check (`pip-licenses`, `license-checker`) against an allow-list, secret scan (gitleaks), container build + Trivy scan. Branch protection: all green plus one review. Deploy to staging on merge to `main`; production by manual approval with the same image digest.

## 6. Event bus and outbox (Blueprint §13)

v2.0: every consequential state change writes to `audit_events` (append-only DB table). Consumers read via polling or DB trigger.

Future tracks (Track F): route `audit_events` to Google Cloud Pub/Sub using the transactional outbox pattern:
- Domain events written to `outbox` table in the same DB transaction as state changes.
- A relay process reads the outbox and publishes to Pub/Sub topics.
- Consumers tolerate duplicates and out-of-order delivery.
- Core event envelope (Blueprint §13) is the schema for all published events.

This avoids database/event divergence without a distributed transaction.

## 7. Data residency and lifecycle

- **Residency**: Cloud SQL regional deployment; data residency policy configurable per org. AI data handling: define whether prompts/results may be retained by Gemini/Vertex; use enterprise agreements and avoid sending unrelated tenant data to model providers (Blueprint §15).
- **Retention**: runs logs and test output deleted after 90 days; artifact bucket lifecycle rules. Log retention 30 days.
- **Export**: organization-level JSON + Markdown export. Verified export before deleting an org.
- **Deletion**: the ledger is append-only, so deletion removes payload content and keeps hashes (tombstone entry); this must be agreed with legal first. Personal data (email, display name, activity) follows a data subject deletion path.
- **Encryption**: Cloud SQL at rest (default) and in transit; Secret Manager + KMS; secrets are server-side secret references, never client-readable values (Blueprint §15).

## 8. Dependency management and SBOM (Blueprint §15)

- Pinned lockfiles (`uv.lock`, `package-lock.json`).
- `pip-audit` and `npm audit` in CI; container image scanned with Trivy.
- License allow-list enforced by `pip-licenses` and `license-checker` in CI.
- Vendored OSS pinned to a commit recorded in `THIRD_PARTY_NOTICES.md`; updates by PR with diff review.
- SBOM (CycloneDX or SPDX) generated per release and stored with the artifact.
- Vulnerability monitoring: alerting when a dependency CVE is published; patch SLA by severity.

## 9. Evaluation harness (Blueprint §16)

Run these suites on every release candidate, not just at launch:
- Golden task suites by language/framework/task type (stored in `tests/fixtures/`).
- Regression evaluations for prompts, skills, tools and model upgrades.
- Sandbox integration tests.
- Workflow replay tests from recorded sanitized events.
- Permission leakage tests across tenants/projects (layer 6 security tests).
- Prompt-injection and malicious repository tests.
- Visual regression for major screens (layer 7).
- Human review sampling: a sample of completed tasks reviewed by a person monthly; findings tracked.

Metrics tracked (Blueprint §16):
- Acceptance-criterion pass rate, tests added/passing, review precision/false positives.
- Human override rate, context retrieval relevance, stale-context incidence, escalation rate.
- Cost per verified task by provider and task class.

## 10. Product basics

Decide and document, then build only what applies:
- **Billing and plans**: Stripe (or invoicing) with plan limits mapped to the quotas in sections 3 and 4. The landing page pricing section is shown only when plans exist.
- **Legal**: Terms of Service, Privacy Policy, Data Processing Addendum, subprocessors list (Google Cloud, Gemini, GitHub). Linked from the footer and sign-up.
- **Data lifecycle**: retention periods for runs, patches and test output; organization export (JSON + Markdown) and deletion.
- **Support**: support email, status page, in-app feedback link.

## 11. Performance targets

API p95 under 300 ms for non-model endpoints; evaluation under 60 s on Gemini; first byte of landing under 1.5 s on mobile; ledger verify streams so it works at 1M entries; DB indexes on every foreign key and on `(org_id, created_at)`.
