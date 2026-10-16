-- 010_idea_approvals.sql
-- Idea approval workflow (assign reviewers -> approve/reject -> create project)
-- and project leads who can enrol their own team.

CREATE TABLE IF NOT EXISTS idea_approvals (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_id       uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    reviewer_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_by  uuid NOT NULL REFERENCES users(id),
    status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
    note          text,
    reason        text,
    requested_at  timestamptz NOT NULL DEFAULT now(),
    decided_at    timestamptz,
    UNIQUE (idea_id, reviewer_id)
);

-- "Waiting for me" lookups.
CREATE INDEX IF NOT EXISTS idx_idea_approvals_reviewer
    ON idea_approvals (reviewer_id, status);

-- Link an approved idea to the project created from it, in both directions.
ALTER TABLE ideas    ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS idea_id    uuid REFERENCES ideas(id)    ON DELETE SET NULL;

-- A lead of a station (design lead, QA lead, ...) may add people to their own team.
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS is_lead boolean NOT NULL DEFAULT false;

GRANT SELECT, INSERT, UPDATE, DELETE ON idea_approvals TO "{{APP_ROLE}}";
