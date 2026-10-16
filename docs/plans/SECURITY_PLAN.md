# Security plan

> **Blueprint alignment:** this plan implements Blueprint §15 (security, privacy and governance), §9 (agent execution security), §8 (context privacy) and §19 (security test layer). Every control from Blueprint §15 is mapped here.

## Threat model (summary)

| Asset | Threat | Control |
|---|---|---|
| Other orgs' data | Cross-tenant read or write | Org scoping helper, Postgres RLS, cross-tenant test suite |
| Roles | User grants themselves Director | Role only from DB membership or invitation; never from the browser or token |
| Invitations | Token guessing, replay, wrong recipient | 256-bit random token, only the hash stored, 7-day expiry, single use, accepting email must match the invited email |
| Ledger | Tampering or deletion | App DB role has SELECT/INSERT only; per-org hash chain; nightly verify job alerts on break |
| Agent-run code | Executes untrusted repo code | Worker has no GitHub or user credentials; egress allow-list; resource limits; patch is published by the control plane only |
| Prompt injection | Repo text or idea text steers the agent | Agent tools restricted to the workspace; no shell outside the test argv; diffs are reviewed by a second model and a human; model output is schema-validated; repository content, issue text and external pages are treated as untrusted data; tool policies live outside retrieved content |
| Callback endpoints | Forged worker callbacks | HMAC run token per run, constant-time compare, run state machine rejects out-of-order completion |
| Secrets | Leak through logs, images or PR bodies | Secret Manager only; log redaction; gitleaks in CI; PR body and test output scrubbed for key patterns |
| Dev auth | `AUTH_MODE=dev` left on in prod | Startup refuses `dev` auth on Cloud Run unless explicitly allowed (already in config); CI check on deploy config |
| Dependencies | Vulnerable or restrictively licensed packages | pip-audit, npm audit, Trivy, license allow-list, pinned lockfiles, SBOM per release |
| Vendored code | Unreviewed upstream changes | `third_party/` pinned to a commit recorded in `THIRD_PARTY_NOTICES.md`; updates by PR with diff review |
| Network egress | Worker exfiltrates data or installs malicious packages | Egress allow-list (package index, git host, model API); VPC connector + firewall rules; no arbitrary outbound |
| AI data handling | Tenant data sent to model provider for training | Enterprise model agreements; define prompt/result retention policy per provider; avoid sending other-tenant data to model APIs |
| Context leakage | Cross-project context retrieval | Cross-project retrieval denied by default; org_id filter on all vector searches; secrets never enter context store |
| Isolation | Workers share resources or file systems | CPU/memory/time limits, filesystem boundaries, process limits, no privileged containers, cleanup, artifact scanning |
| Personal data | PII in logs, prompts or context | Personal data inventory; log scrubbing; data subject export and deletion path; telemetry opt-out |

## Authorization model (Blueprint §15)

RBAC + ABAC (attribute-based access control):
- Org scoping: every read and write checks `org_id` through the `scoped(query, user)` helper.
- Role check: `require_role(roles)` decorator on every route.
- Deny-by-default: a new route with no `require_role` fails the route-coverage test.
- Least privilege: short-lived credentials, explicit project grants, invitation scope.
- Access reviews: audit log of all role grants and changes.
- Server-side enforcement: authorization is checked server-side for every request and tool call.
- AI never approves its own changes or bypasses branch protection.

## Required controls before launch

1. **Authentication**: Firebase with verified email only; session expiry; sign-out everywhere; optional SSO (SAML/OIDC) for enterprise orgs as a follow-up.
2. **Authorization**: one `require_role` check per route plus org scope; a test enumerates every route and fails if a route lacks both.
3. **Rate limiting**: sign-in, invitation create/accept, run start, model-backed endpoints, per user and per IP (Cloud Armor plus an application limiter).
4. **Input handling**: Pydantic limits on every text field; uploaded or repo-derived text is never rendered as HTML (React escaping only; Markdown rendered with a sanitizer).
5. **HTTP hardening**: CSP without `unsafe-inline`, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`, CORS allow-list from settings.
6. **Audit**: every state change writes a ledger entry with actor and org; admin reads of other users' data are logged.
7. **Secrets rotation**: documented procedure for `RUN_HMAC_SECRET` (worker run tokens only), `SESSION_JWT_SECRET` (user sessions only; rotating it signs everyone out), `GITHUB_TOKEN`, `GEMINI_API_KEY`; GitHub token scoped to the one repository, contents + pull requests only.
8. **Backups and encryption**: Cloud SQL encryption at rest (default) and in transit; backups encrypted.
9. **Pen test**: external or internal test of auth, tenancy and the worker sandbox before general availability; findings tracked to closure.
10. **Privacy**: personal data inventory (email, display name, activity); data subject export and deletion path.

## Agent execution security (Blueprint §15)

- Workers run in isolated containers: CPU/memory/time limits, read-only root filesystem except `/tmp`, no privileged mode.
- Network egress controls: workers can only reach the package index, the git host and the model API; all other outbound connections are blocked.
- No long-lived credentials in workers: credentials are short-lived and scoped per run.
- Tool policies live outside retrieved content: prompt injection cannot add or modify tool call permissions.
- Package install scripts from repositories are untrusted; run in the sandbox only after explicit allow.
- Artifact scanning: worker output is scanned for credential patterns before publishing.

## Human approval gates (Blueprint §15)

These actions require explicit human approval and cannot be bypassed by an agent:
- Production deployment
- Branch protection bypass
- Destructive changes (data deletion, schema drops)
- Credential rotation
- Data export
- Security waivers
- Policy changes

## Dependency and supply chain (Blueprint §15)

- `pip-audit` and `npm audit` in CI.
- Container image scanned with Trivy.
- License allow-list enforced in CI.
- Pinned lockfiles (`uv.lock`, `package-lock.json`).
- SBOM (CycloneDX or SPDX) generated per release.
- Vulnerability monitoring: alert on new CVE for any dependency; patch SLA by severity.
- Vendored OSS: `third_party/` pinned to commit in `THIRD_PARTY_NOTICES.md`; diff review required for upgrades.

## Verification

- `tests/security/`: cross-tenant, role-escalation, invitation misuse, forged callback, oversized input, route-coverage tests, prompt injection tests, SSRF tests, secret leakage checks.
- CI gates from the production readiness plan (audit, scan, secrets, SBOM).
- Sign-off by someone other than the author before launch.

## Open decisions (Blueprint §21)

1. Tenant isolation model: pooled first with strict RLS and storage namespaces, or cell-based from the first deployment?
2. Initial auth: Google sign-in only for first release, with enterprise federation interface prepared?
3. Data residency and provider data-retention requirements per org.
4. AI data handling: which Gemini/Vertex enterprise data handling agreements apply?
5. Production deployment policy and required sign-off quorum.
6. Context retention and org-memory approval roles.

Record decisions as ADRs (Architecture Decision Records) with alternatives, evidence, trade-offs, owner and review date.
