-- 035_qa_suggestions.sql
-- The QA agent never files bugs. It suggests them, each tied to code it can
-- point at; a QA engineer accepts a suggestion (which files the bug to the
-- developer) or dismisses it with a reason. issues.qa_agent tracks the agent's
-- last run on a story.

CREATE TABLE IF NOT EXISTS qa_suggestions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_id     uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    title        text NOT NULL,
    description  text NOT NULL DEFAULT '',
    category     text NOT NULL DEFAULT 'functional',
    severity     text NOT NULL DEFAULT 'P2' CHECK (severity IN ('P0', 'P1', 'P2', 'P3')),
    steps        jsonb NOT NULL DEFAULT '[]'::jsonb,
    expected     text NOT NULL DEFAULT '',
    evidence     jsonb NOT NULL DEFAULT '[]'::jsonb,
    status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
    reason       text,
    bug_id       uuid REFERENCES issues(id) ON DELETE SET NULL,
    model        text NOT NULL DEFAULT '',
    decided_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    decided_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_suggestions_issue_idx ON qa_suggestions (issue_id, status);
CREATE INDEX IF NOT EXISTS qa_suggestions_project_idx ON qa_suggestions (project_id, status);

ALTER TABLE qa_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON qa_suggestions;
CREATE POLICY tenant_isolation ON qa_suggestions FOR ALL
    USING (karkhana_project_ok(project_id)) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON qa_suggestions TO "{{APP_ROLE}}";

ALTER TABLE issues ADD COLUMN IF NOT EXISTS qa_agent jsonb;
