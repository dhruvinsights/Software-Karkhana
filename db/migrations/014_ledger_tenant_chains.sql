-- 014_ledger_tenant_chains.sql
-- One hash chain per tenant instead of one global chain.
--
--   chain       'legacy'         every row written before this migration (the old
--                                global chain, kept as-is so it still verifies);
--               '<workspace id>' rows for that workspace;
--               'platform'       rows with no workspace (sign-ups, legacy projects
--                                that have no workspace, control-plane events).
--   chain_seq   1-based position inside the chain (NULL for legacy rows). New rows
--               hash their chain and chain_seq, so a row cannot be moved between
--               chains without breaking the link.
--   workspace_id  the tenant, for filtering. Not hashed on legacy rows.
--
-- Legacy rows are not re-hashed: their stored hashes stay valid and the legacy
-- chain verifies from genesis exactly as before. Because the legacy chain mixes
-- tenants it is verified by operators (app.scripts.anchor_ledger), not through
-- the per-workspace API. New chains start at genesis.
--
-- Grants: only columns are added to an existing table, so the SELECT/INSERT
-- grants in 002_grants.sql already cover them. No new sequence.

ALTER TABLE ledger ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS chain text NOT NULL DEFAULT 'legacy';
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS chain_seq bigint;

-- Backfill the tenant of legacy rows so the API can scope them. The append-only
-- trigger blocks UPDATE even for the owner, so it is lifted for this one
-- statement only (inside the migration's transaction). Only workspace_id is
-- written, and only on legacy rows, where it is not part of the hash.
ALTER TABLE ledger DISABLE TRIGGER ledger_no_update_delete;

UPDATE ledger l
   SET workspace_id = p.workspace_id
  FROM projects p
 WHERE l.chain = 'legacy' AND l.workspace_id IS NULL
   AND l.project_id = p.id AND p.workspace_id IS NOT NULL;

UPDATE ledger l
   SET workspace_id = w.id
  FROM workspaces w
 WHERE l.chain = 'legacy' AND l.workspace_id IS NULL AND l.project_id IS NULL
   AND l.subject_type = 'workspace' AND l.subject_id = w.id::text;

UPDATE ledger l
   SET workspace_id = i.workspace_id
  FROM ideas i
 WHERE l.chain = 'legacy' AND l.workspace_id IS NULL AND l.project_id IS NULL
   AND l.subject_type = 'idea' AND l.subject_id = i.id::text
   AND i.workspace_id IS NOT NULL;

ALTER TABLE ledger ENABLE TRIGGER ledger_no_update_delete;

CREATE INDEX IF NOT EXISTS ledger_chain_seq ON ledger (chain, seq);
CREATE INDEX IF NOT EXISTS ledger_workspace_seq ON ledger (workspace_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_chain_position
    ON ledger (chain, chain_seq) WHERE chain_seq IS NOT NULL;
