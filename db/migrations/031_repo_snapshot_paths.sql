-- 031_repo_snapshot_paths.sql
-- Every tracked path at the snapshot commit (`git ls-files`), including the
-- lockfiles and binaries repomix leaves out of `files`. Citations and stack
-- detection check against this list.

ALTER TABLE repo_snapshots ADD COLUMN IF NOT EXISTS paths jsonb NOT NULL DEFAULT '[]'::jsonb;
