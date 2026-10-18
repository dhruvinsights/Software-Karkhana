-- 041_issue_edit_tracking.sql
-- Track who last edited an issue and why.
-- edit_comment is required on the API when a content field (title, description,
-- acceptance_criteria) is changed; it is not enforced at the DB level so that
-- programmatic migrations and test fixtures can still run cleanly.

ALTER TABLE issues
    ADD COLUMN IF NOT EXISTS last_edited_by_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS last_edited_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS edit_comment        TEXT        DEFAULT '';
