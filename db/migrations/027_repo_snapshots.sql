-- 027_repo_snapshots.sql
-- A compressed, AI-readable copy of a product's repository at one commit,
-- produced by repomix (--compress keeps signatures and drops bodies). Every
-- AI step that needs to "know the code" (idea scan, evaluation report, PRD,
-- coding) reads the latest snapshot instead of cloning again, and every file
-- path a model cites is checked against `files`.

CREATE TABLE IF NOT EXISTS repo_snapshots (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repo_url      text NOT NULL,
    commit_sha    text NOT NULL,
    tree          text NOT NULL,
    files         jsonb NOT NULL,           -- {"path": "compressed content"}
    file_count    integer NOT NULL,
    chars         integer NOT NULL,
    created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repo_snapshots_product ON repo_snapshots (product_id, created_at DESC);

ALTER TABLE repo_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON repo_snapshots;
CREATE POLICY tenant_isolation ON repo_snapshots FOR ALL
    USING (karkhana_ws_ok(workspace_id)) WITH CHECK (true);

GRANT SELECT, INSERT, DELETE ON repo_snapshots TO "{{APP_ROLE}}";
