-- 032_idea_scope_groups.sql
-- An idea is a "feature" (one piece of work that lands in an existing project)
-- or a "project" (a group of related features, worth a PRD and its own teams).
-- Features point at the project idea that groups them. `delivery` tracks an
-- approved feature being drafted into an existing project as an epic.

ALTER TABLE ideas ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'feature';
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES ideas(id) ON DELETE SET NULL;
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS delivery jsonb;
CREATE INDEX IF NOT EXISTS ideas_parent_id_idx ON ideas (parent_id);
