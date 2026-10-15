# Operations plan

> **Blueprint alignment:** this plan implements Blueprint §16 (observability, evaluation and product metrics) and §18 (Track A exit criteria: logs/traces/metrics and audit events).

## Service levels

| Objective | Target |
|---|---|
| API availability | 99.5% monthly at launch |
| Run start latency | 90% of runs start within 60 s |
| Evaluation latency | p95 under 90 s on Gemini |
| Data durability | RPO 5 minutes (point-in-time recovery), RTO 1 hour |

## Observability (Blueprint §16)

- **Logs**: structured JSON to Cloud Logging with `request_id`, `org_id`, `user_id`, `run_id`. No prompt or diff bodies in logs by default. Redact secrets and personal data.
- **Metrics (runtime — Blueprint §16)**: request rate/latency/errors, model call latency/errors/tokens by provider, queue of runs by status, run duration by phase, review engine latency, ledger append latency, DB connections, sandbox utilization, retry count, tool failures, adapter sync lag, event lag.
- **Tracing**: OpenTelemetry (already scaffolded in `app/app_utils/telemetry.py`) across API, worker and model calls. Propagate correlation IDs from workflow to agent run to tool call.
- **Error tracking**: Cloud Error Reporting, or Sentry if you choose it; both strip secrets.
- **Dashboards**: one for API health, one for runs and models, one for cost, one for AI quality (Blueprint §16).
- **Alerts** (page vs ticket):
  - page: API 5xx > 2% for 5 min, health check failing, DB unavailable, ledger verify failure, run heartbeat stalls > 10 min on several runs
  - ticket: model budget 80%, Gemini error rate rising, migration pending, certificate expiry within 14 days

## AI quality metrics (Blueprint §16)

Track these per task class and provider; do not optimize only for tokens or agent self-reported success:
- Acceptance-criterion pass rate.
- Tests added / tests passing.
- Review precision and false-positive rate.
- Successful task completion after verification (not agent-reported "done").
- Human override rate.
- Context retrieval relevance score.
- Stale-context incidence.
- Escalation rate.
- Cost per verified task by provider and model.

## Product outcome metrics (Blueprint §16)

- Time from task creation to first verified change.
- Lead time and blocked time per stage.
- Human override rate for agent actions.
- Reopened defects.
- Security findings by age.
- Adoption by role (active users per role per week).
- Onboarding completion rate.
- Integration health (% of integrations in Healthy state).

## Reliability

- Run reaper job: runs without heartbeat past `RUN_HEARTBEAT_TIMEOUT_SEC` are marked `timed_out` and the project is returned to a retryable stage (the control plane already has the state transitions).
- Idempotent publishing: re-delivered `/complete` callbacks do not open a second PR (claim logic exists; add a test per failure point).
- Model calls: timeout, bounded retries, circuit breaker, clear user-facing error with a retry action.
- Graceful degradation: if the model is down, the app stays usable for reading, triage and merge; evaluation and runs show an honest unavailable state. No cached fake answers.

## Database

- Migrations: forward-only, each file idempotent, applied by the migrate job before the new revision takes traffic. Expand/contract rule: never drop a column in the same release that stops using it.
- Backups: automated daily plus point-in-time recovery; a restore drill each quarter into a scratch instance with ledger verify afterwards.
- Maintenance: vacuum/analyze defaults, index review monthly, pgvector index (`hnsw`) rebuild when the embedding model changes.

## Release process

1. PR green in CI.
2. Merge to `main` deploys staging automatically, runs migrate, smoke tests and the Playwright golden path.
3. Manual approval promotes the same image digest to production.
4. Traffic shifts 10% → 100% over 15 minutes while error rate and latency are watched; automatic rollback on alert.
5. Changelog entry and version tag.

## Runbooks (`docs/runbooks/`)

One page each, with symptoms, checks, fix and escalation:
- API down or 5xx spike
- Model provider outage or quota exhausted
- Ollama host unreachable
- Runs stuck or timing out
- PR publish failure or GitHub token expired
- Ledger verify failure
- Migration failed mid-deploy (rollback)
- Restore from backup
- Suspected tenant data exposure (security incident)
- Secret rotation
- AX cluster unreachable or `ax` CLI missing
- PR-Agent venv broken or review timeout
- Context store out of sync (DB vs Git)
- Worker egress blocked (false positive on allow-list)
- Model budget exhausted

## Support and incident process

- On-call rota with named owners, acknowledgement within 15 minutes for pages.
- Incident template: timeline, impact, cause, fix, follow-ups; written within 3 business days for any page.
- Public status page and a customer notice template.

## Cost control

Per-org model budgets, daily spend report, Cloud Run max instances, job concurrency caps, artifact bucket lifecycle (delete test logs after 90 days), log retention 30 days.

## Evaluation harness operations (Blueprint §16)

- **Golden task suites**: run on every release candidate; regressions block the release.
- **Workflow replay tests**: replay sanitized recorded events; detect prompt or policy regressions.
- **Human review sampling**: a person reviews a random sample of completed tasks monthly; false-positive and failure rates tracked.
- **Prompt injection and malicious repo tests**: run as part of the release evaluation, not only in CI.
- **Visual regression**: screenshot diff on every PR; human review for flagged diffs.
- Store evaluation results in `audit_events` with `event_type=evaluation.run.result` for dashboarding and trend analysis.
