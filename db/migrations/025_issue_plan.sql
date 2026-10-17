-- 025_issue_plan.sql
-- Epics and stories live in `issues`: parent links, acceptance criteria, and a
-- draft state that a lead approves before anything reaches the backlog.
-- Only widens existing checks, so current rows stay valid.

ALTER TABLE issues ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES issues(id) ON DELETE CASCADE;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS epic_id uuid REFERENCES epics(id) ON DELETE SET NULL;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS source_quote text NOT NULL DEFAULT '';
ALTER TABLE issues ADD COLUMN IF NOT EXISTS estimate integer;

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_type_check;
ALTER TABLE issues ADD CONSTRAINT issues_type_check
    CHECK (type IN ('epic', 'story', 'bug', 'task', 'chore', 'security'));

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_status_check;
ALTER TABLE issues ADD CONSTRAINT issues_status_check
    CHECK (status IN ('draft', 'backlog', 'ready', 'todo', 'in_progress', 'in_review',
                      'ready_for_qa', 'in_qa', 'done', 'wont_fix'));

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_source_check;
ALTER TABLE issues ADD CONSTRAINT issues_source_check
    CHECK (source IN ('manual', 'qa', 'security', 'ci', 'review', 'plan'));

CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues (parent_id);
-- One issue per generated epic / story, so re-running the plan never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_issues_epic ON issues (epic_id) WHERE epic_id IS NOT NULL AND type = 'epic';
CREATE UNIQUE INDEX IF NOT EXISTS uq_issues_task ON issues (task_id) WHERE task_id IS NOT NULL AND source = 'plan';
