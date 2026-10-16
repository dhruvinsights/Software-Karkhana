-- Migration 009: GitHub OAuth tokens + PR check-run tracking
-- These tables support the device-flow OAuth + live CI check-run status.

-- Persisted OAuth tokens (one per user; rotated on each successful device flow)
CREATE TABLE IF NOT EXISTS github_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL,
    scopes      TEXT NOT NULL DEFAULT 'repo,read:org',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id)
);

-- GitHub check-run IDs linked to our pull_requests rows (for completion callbacks)
ALTER TABLE pull_requests
    ADD COLUMN IF NOT EXISTS gh_check_run_id  BIGINT,
    ADD COLUMN IF NOT EXISTS ci_conclusion    TEXT;  -- "success"|"failure"|"neutral"|null

-- Index for PR list queries by project
CREATE INDEX IF NOT EXISTS idx_pull_requests_task_id ON pull_requests (task_id);
