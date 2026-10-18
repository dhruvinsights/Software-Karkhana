# Dependency security scans (OSV-Scanner)

Software Karkhana scans a project's dependencies with Google's
[OSV-Scanner](https://github.com/google/osv-scanner). Findings feed a security
gate that blocks merge and QA sign-off until critical vulnerabilities are fixed.

## Requirements

- The `osv-scanner` binary (v2.x) on the API host. The `Dockerfile` installs it
  in the `osvtools` stage. Locally, install it and point `OSV_SCANNER_BIN` at it.
- **Outbound network** from the API host to `api.osv.dev` and `api.deps.dev`.
  Offline mode is not implemented; without a network the scan ends as `failed`
  with the scanner's error, and a failed scan never counts as a pass.
- A repository connected to the project (Product Setup). Without one, starting
  a scan returns 409.

| Env var | Default | Meaning |
| --- | --- | --- |
| `OSV_SCANNER_BIN` | `osv-scanner` | Path of the binary |
| `OSV_SCAN_TIMEOUT_S` | `300` | Per-scan timeout |
| `OSV_RESCAN_INTERVAL_HOURS` | `24` | Scheduled rescan of the base branch; `0` disables it |

## Flow

```
run finishes ──► scan the PR branch ──► findings ──► gate ──► QA sign-off ──► merge
                       ▲                    │                                  │
                       └──── rescan ◄── fix ┘            scan base branch ◄────┘
```

1. **Auto-scan.** When a run completes and produces a PR branch, a scan is
   queued for that branch (unless the project turned `autoScan` off).
2. **Findings.** Each vulnerability in each package becomes one finding with a
   stable fingerprint, so rescans update the same row instead of duplicating it.
   Severity comes from the CVSS score, falling back to the advisory label.
3. **Triage.** Leads assign a finding to a teammate (creates an issue,
   notifies them, writes a ledger entry), ask for an AI fix suggestion, or
   waive it with a reason.
4. **Rescan.** A rescan closes findings that no longer appear as
   `verified fixed` and reopens ones that came back.
5. **Gate.** See below.
6. **Post-merge.** Merging queues a scan of the base branch; a scheduled scan
   also runs every `OSV_RESCAN_INTERVAL_HOURS`. Scans stuck in `running` after
   a restart are recovered on startup.

## Security gate

Default policy: open **CRITICAL** findings block; a scan is not required.
Leads can change it in the Security station or `PUT /api/projects/{id}/security-policy`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `blockSeverities` | `["CRITICAL"]` | Open findings of these severities close the gate. `CRITICAL` cannot be removed |
| `requireScan` | `false` | When true, a project never scanned, with a failed latest scan, or with a scan still running is closed too |
| `autoScan` | `true` | Scan automatically when a run finishes |

The gate is enforced in two places:

- **QA sign-off** (`qa_gate.signoff_problem`): 409 `Security gate closed: ...`.
  The project-level gate counts findings on the base branch.
- **PR merge** (`POST .../merge`): 409 `Cannot merge: security gate closed: ...`.
  The PR-level gate uses the findings of that PR's latest scan.

Waived and verified-fixed findings never block. Releases already refuse open
CRITICAL/HIGH findings independently.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/projects/{id}/security-scans` | Start a scan (`prId` optional); 202, poll the scan |
| POST | `/api/projects/{id}/security-scans/rescan` | Rescan after fixes |
| GET | `/api/projects/{id}/security-scans` | Scan history |
| GET | `/api/security-scans/{scanId}` | One scan and its status |
| GET | `/api/projects/{id}/security-summary` | Counts, latest scan, policy, gate |
| PUT | `/api/projects/{id}/security-policy` | Change the gate (leads only) |
| POST | `/api/security-findings/{id}/assign` | Assign or unassign |
| POST | `/api/security-findings/{id}/fix-suggestion` | AI fix suggestion |
| GET | `/api/projects/{id}/security-report` | JSON report with a rendered `markdown` field |

Existing finding endpoints (`/security-findings`, waive, reopen) keep working
and now return package, version, manifest, fixed version, CVSS and SLA fields.

## Audit and notifications

Scan queued, completed or failed, policy changes, assignment, waive and reopen are
written to the ledger. Scan results post an in-app notice to the project lead,
the person who started the scan and, for a PR scan, the PR's developer: when new
findings close the gate (this one also sends an email with the fix advice), when
findings appear or get fixed, and when a scan fails. Assigning a finding
notifies the assignee.

## AI fix suggestions

`security_fix` asks the configured model for a concrete fix (upgrade target,
breaking-change risk, steps). If the model is unavailable it returns the
scanner's own advice, labelled as such. Suggestions are advice only; nothing is
applied automatically.

## Tests

```
pytest tests/unit/test_security_rules.py
pytest tests/integration/test_security_scans.py
```

The integration tests run against real Postgres. Only the scanner binary, the
git checkout and `publisher.publish` are mocked; the parser is validated
against real v2.7.0 output (`tests/fixtures/osv_sample.json`).
