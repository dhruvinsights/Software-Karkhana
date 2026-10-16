-- 019_workspace_access_project_archive.sql
-- Workspace access levels (separate from job title) and soft-deleted projects.

-- access: what a member may do in the workspace, independent of their title.
--   owner  the person who created the workspace (exactly one)
--   admin  manages members and guides, deletes projects, edits the product
--   guide  read-only advisor: sees every project, idea and discussion, may comment
--   member regular teammate
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS access text NOT NULL DEFAULT 'member';
UPDATE workspace_members SET access = 'owner' WHERE is_owner AND access = 'member';
ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS workspace_members_access_check;
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_access_check
    CHECK (access IN ('owner', 'admin', 'guide', 'member'));

-- Projects are archived, not deleted: the append-only ledger references them.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS projects_workspace_live_idx ON projects(workspace_id) WHERE archived_at IS NULL;
