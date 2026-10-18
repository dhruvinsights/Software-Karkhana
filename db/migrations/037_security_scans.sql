-- 037_security_scans.sql
-- OSV-Scanner integration: one row per dependency scan, and scanner-created
-- findings that carry enough detail (package, fixed version, AI fix) to act on
-- and to be re-checked by a rescan.

CREATE TABLE IF NOT EXISTS security_scans (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id      uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    trigger           text NOT NULL DEFAULT 'manual'
                      CHECK (trigger IN ('manual', 'pr', 'merge', 'schedule', 'rescan')),
    status            text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    ref               text,
    commit_sha        text,
    pr_id             uuid REFERENCES pull_requests(id) ON DELETE SET NULL,
    started_by        uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    started_at        timestamptz,
    finished_at       timestamptz,
    counts            jsonb NOT NULL DEFAULT '{}'::jsonb,
    finding_ids       jsonb NOT NULL DEFAULT '[]'::jsonb,
    packages_affected integer NOT NULL DEFAULT 0,
    new_findings      integer NOT NULL DEFAULT 0,
    resolved_findings integer NOT NULL DEFAULT 0,
    gate              text CHECK (gate IS NULL OR gate IN ('passed', 'blocked')),
    error             text,
    note              text,
    scanner_version   text
);
CREATE INDEX IF NOT EXISTS idx_security_scans_project
    ON security_scans (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_scans_workspace ON security_scans (workspace_id);

-- Scanner-created findings have no human author, so created_by becomes optional.
ALTER TABLE security_findings ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE security_findings
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS fingerprint text,
    ADD COLUMN IF NOT EXISTS ref text,
    ADD COLUMN IF NOT EXISTS scan_id uuid REFERENCES security_scans(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS resolved_by_scan_id uuid REFERENCES security_scans(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS osv_id text,
    ADD COLUMN IF NOT EXISTS aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS package_name text,
    ADD COLUMN IF NOT EXISTS package_version text,
    ADD COLUMN IF NOT EXISTS ecosystem text,
    ADD COLUMN IF NOT EXISTS fixed_version text,
    ADD COLUMN IF NOT EXISTS manifest_path text,
    ADD COLUMN IF NOT EXISTS references_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS ai_fix jsonb,
    ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS issue_id uuid REFERENCES issues(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- One live row per vulnerability-in-package per project: a rescan updates it
-- instead of piling up duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_security_findings_fingerprint
    ON security_findings (project_id, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_security_findings_assignee
    ON security_findings (assignee_id) WHERE assignee_id IS NOT NULL;

ALTER TABLE security_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON security_scans;
CREATE POLICY tenant_isolation ON security_scans FOR ALL
    USING (karkhana_ws_ok(workspace_id)) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON security_scans TO "{{APP_ROLE}}";
