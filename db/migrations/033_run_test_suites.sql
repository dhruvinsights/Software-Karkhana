-- 033_run_test_suites.sql
-- Each test suite a run executes (unit, integration, ...) with its live state
-- and counts, so the Developer station can show progress per suite.
-- [{"suite": "unit", "status": "running|passed|failed|error", "passed": 12,
--   "failed": 0, "skipped": 1, "total": 13, "command": "...", "durationMs": 820,
--   "output": "last lines"}]

ALTER TABLE runs ADD COLUMN IF NOT EXISTS test_suites jsonb NOT NULL DEFAULT '[]'::jsonb;
