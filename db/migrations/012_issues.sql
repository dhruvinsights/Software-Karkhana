-- 012_issues.sql
-- Persisted issues and bugs with assignment (replaces the browser-only demo list).

CREATE TABLE IF NOT EXISTS issues (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number        integer NOT NULL,
    title         text NOT NULL,
    description   text NOT NULL DEFAULT '',
    type          text NOT NULL DEFAULT 'task'
                  CHECK (type IN ('story', 'bug', 'task', 'chore', 'security')),
    priority      text NOT NULL DEFAULT 'P2'
                  CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
    status        text NOT NULL DEFAULT 'todo'
                  CHECK (status IN ('todo', 'in_progress', 'in_review', 'done', 'wont_fix')),
    source        text NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'qa', 'security', 'ci', 'review')),
    labels        jsonb NOT NULL DEFAULT '[]'::jsonb,
    reporter_id   uuid NOT NULL REFERENCES users(id),
    assignee_id   uuid REFERENCES users(id) ON DELETE SET NULL,
    task_id       uuid REFERENCES tasks(id) ON DELETE SET NULL,
    pr_id         uuid REFERENCES pull_requests(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    closed_at     timestamptz,
    UNIQUE (project_id, number)
);

CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues (project_id, status);
CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues (assignee_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON issues TO "{{APP_ROLE}}";
