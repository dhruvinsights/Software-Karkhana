-- 030_releases.sql
-- A release is a record before it is a tag: the merged pull requests and
-- stories it ships, their QA results, open security findings and the CI state
-- of the commit, gathered by Karkhana. A release manager approves it, which
-- creates the tag and the GitHub Release; the repository's release workflow
-- then publishes the build.

CREATE TABLE IF NOT EXISTS releases (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version      text NOT NULL CHECK (version ~ '^v[0-9]+\.[0-9]+\.[0-9]+$'),
    status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    manifest     jsonb NOT NULL,
    blockers     jsonb NOT NULL DEFAULT '[]'::jsonb,
    notes        text NOT NULL DEFAULT '',
    commit_sha   text NOT NULL DEFAULT '',
    release_url  text,
    created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, version)
);

ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON releases;
CREATE POLICY tenant_isolation ON releases FOR ALL
    USING (karkhana_project_ok(project_id)) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON releases TO "{{APP_ROLE}}";
