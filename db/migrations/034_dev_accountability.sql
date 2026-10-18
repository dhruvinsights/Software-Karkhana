-- 034_dev_accountability.sql
-- The developer's own manual check of a story (before QA signs it off) or of a
-- bug fix (before QA verifies it): who, when, each acceptance criterion and notes.
-- Bugs count how often QA reopened them. PRs record who was asked to review.

ALTER TABLE issues ADD COLUMN IF NOT EXISTS dev_check jsonb;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0;
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS requested_reviewers jsonb NOT NULL DEFAULT '[]'::jsonb;
