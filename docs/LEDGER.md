# Evidence ledger: tenant chains and external anchors

`app/ledger.py` keeps an append-only SHA-256 hash chain in Postgres. Since
migration `014_ledger_tenant_chains.sql` there is **one chain per tenant**.

## Chains

| `chain` value | Holds | Verified by |
|---|---|---|
| `<workspace id>` | Every entry whose project, workspace, idea or product belongs to that workspace | Its members: `GET /api/ledger/verify?workspace_id=…` |
| `platform` | Entries with no workspace: OAuth sign-ups, control-plane events, legacy projects without a workspace | Included in every caller's `GET /api/ledger/verify` (contents are not returned, only ok/count/head) |
| `legacy` | Every row written before migration 014 (the old single global chain) | Operators only: `python -m app.scripts.anchor_ledger --verify` |

- `ledger.append(session, ..., workspace_id=...)` picks the chain. Leave
  `workspace_id` out and it is inferred from `project_id`, or from a
  `workspace` / `idea` / `product` / `project` subject. Pass `workspace_id=None`
  for an explicit platform event.
- Each append takes `pg_advisory_xact_lock(0x4B41524B, hashtext(chain))`, so a
  chain stays linear across Cloud Run instances and tenants never wait on each
  other.
- New rows hash `chain` and `chain_seq` (1-based position) as well as the
  original fields, so a row cannot be moved between tenants. `workspace_id` is
  checked against the chain on verification.

### Backwards compatibility (the legacy chain)

Pre-014 rows are **not re-hashed**. They keep `chain = 'legacy'` and
`chain_seq = NULL`, and verify from genesis with the original body exactly as
before. Migration 014 backfills their `workspace_id` (from the project,
workspace or idea) so the API can scope them; that column is not part of a
legacy hash. Because the legacy chain mixes tenants, it is not exposed through
the per-workspace API. Every new chain starts at genesis; nothing new is ever
appended to `legacy` by the app. (A raw `INSERT` that omits `chain` also lands
there, by the column default, and never in a tenant's chain.)

## External anchors

A chain stored in the database it protects proves detection, not prevention:
the database owner could rewrite a whole chain consistently. So the chain head
`{chain, workspace_id, position, seq, hash, entry_at, anchored_at, reason}` is
also written outside the database:

- automatically, after commit, whenever `chain_seq % LEDGER_ANCHOR_EVERY == 0`
  (default 50; 0 disables). A rolled-back transaction never writes an anchor;
- on demand: `POST /api/ledger/anchor?workspace_id=…` (workspace members);
- on a schedule: `python -m app.scripts.anchor_ledger` anchors every chain
  (run it as a Cloud Run Job from Cloud Scheduler).

| Setting | Default | Meaning |
|---|---|---|
| `LEDGER_ANCHOR_BUCKET` | unset | GCS bucket. Objects `ledger-anchors/<chain>/<position>-<time>.json`, uploaded create-only (`if_generation_match=0`). Set by `cloudbuild.yaml` to `<project>-karkhana-ledger-anchors` |
| `LEDGER_ANCHOR_PREFIX` | `ledger-anchors` | Object prefix |
| `LEDGER_ANCHOR_PATH` | `./.ledger-anchors.jsonl` | Local JSONL sink when no bucket is set (development only; ephemeral on Cloud Run) |
| `LEDGER_ANCHOR_EVERY` | `50` | Auto-anchor interval per chain |

Anchoring never breaks a request. A failed upload is logged with the full
anchor (Cloud Logging therefore holds a second copy of the head) and recorded
in the local JSONL with `status: "sink_failed"`; the manual endpoint returns
`ok: false` with the error.

`infra/bootstrap.sh` creates the bucket with a retention policy
(`LEDGER_RETENTION`, default 400 days) and grants the API service account
create + read only. **Locking the retention policy is irreversible** and is left
as a commented command: run it for production once the period is right.

### Checking a chain against its anchors

```bash
python -m app.scripts.anchor_ledger --verify
```

`verify_chain(session, chain, anchors=load_anchors(chain))` fails with
`hash differs from external anchor` when an anchored position now holds a
different hash (a consistent rewrite), and with `anchored entries are missing`
when the chain is shorter than its last anchor (a truncated tail).
