-- Shared context: decisions, notes and handoffs that people and agents both
-- read. Insert-only for the app role, like approvals: context is added, not rewritten.
CREATE TABLE IF NOT EXISTS context_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    kind text NOT NULL CHECK (kind IN ('decision', 'note', 'handoff')),
    title text NOT NULL,
    body text NOT NULL,
    author_label text NOT NULL,
    author_kind text NOT NULL CHECK (author_kind IN ('human', 'ai', 'system')),
    run_id uuid REFERENCES runs(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS context_entries_project_idx ON context_entries (project_id, created_at DESC);

GRANT SELECT, INSERT ON context_entries TO "{{APP_ROLE}}";
