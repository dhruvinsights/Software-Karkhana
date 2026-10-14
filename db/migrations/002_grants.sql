-- Least privilege for the application role. {{APP_ROLE}} is replaced by
-- migrate.py: "karkhana_app" locally, the Cloud Run service account's IAM
-- database user (e.g. "karkhana-run@PROJECT.iam") on Cloud SQL.

GRANT USAGE ON SCHEMA public TO "{{APP_ROLE}}";

GRANT SELECT, INSERT, UPDATE ON
    users, projects, evaluations, epics, tasks, runs,
    pull_requests, review_comments, learnings
TO "{{APP_ROLE}}";

-- Re-evaluation redrafts epics and Draft tasks (live tasks are never deleted).
GRANT DELETE ON epics, tasks TO "{{APP_ROLE}}";

-- Approvals are decisions: they are recorded, never edited.
GRANT SELECT, INSERT ON approvals TO "{{APP_ROLE}}";

-- The ledger: INSERT and SELECT only. No UPDATE, DELETE or TRUNCATE.
REVOKE ALL ON ledger FROM "{{APP_ROLE}}";
GRANT SELECT, INSERT ON ledger TO "{{APP_ROLE}}";
GRANT USAGE, SELECT ON SEQUENCE ledger_seq_seq TO "{{APP_ROLE}}";
