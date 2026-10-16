-- 011_invites.sql
-- Invites that can also enrol into a project, expire, and record who accepted.

ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS project_id  uuid REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS stations    jsonb;
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS is_lead     boolean NOT NULL DEFAULT false;
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS expires_at  timestamptz NOT NULL DEFAULT now() + interval '14 days';
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

ALTER TABLE workspace_invites DROP CONSTRAINT IF EXISTS workspace_invites_status_check;
ALTER TABLE workspace_invites ADD CONSTRAINT workspace_invites_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked'));

CREATE INDEX IF NOT EXISTS idx_workspace_invites_ws ON workspace_invites (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON workspace_invites (lower(email));
