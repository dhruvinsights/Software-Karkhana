-- v2: embeddings are tagged with the model that made them, PRs record which
-- review engine produced the verdict, and cached evaluations are gone.
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS embedding_model text;

ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS review_engine text;
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS review_model text;
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS review_summary text;
-- PRs that already have comments were reviewed before this column existed.
UPDATE pull_requests SET reviewed_at = COALESCE(merged_at, now())
 WHERE reviewed_at IS NULL
   AND id IN (SELECT pr_id FROM review_comments);

ALTER TABLE evaluations DROP COLUMN IF EXISTS served_from_cache;

-- First-run onboarding is a fact about a user, stored server-side.
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;
