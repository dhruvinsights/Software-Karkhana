-- 026_agent_jobs.sql: one row per role-agent run (designer, architect, developer,
-- qa, security, release), plus an append-only log per job. Each job has its own
-- sandbox directory and its own log stream, so a person can watch exactly what
-- one agent did. Tenant isolation follows the project, like `runs`.

CREATE TABLE IF NOT EXISTS agent_jobs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_id     uuid REFERENCES issues(id) ON DELETE SET NULL,
    role         text NOT NULL CHECK (role IN
                   ('product','design','architecture','developer','qa','devops','security','release')),
    engine       text NOT NULL DEFAULT 'ollama' CHECK (engine IN ('ollama','bob')),
    model        text,
    status       text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
    instruction  text NOT NULL DEFAULT '',
    output       text NOT NULL DEFAULT '',
    error        text,
    sandbox      text,
    requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    started_at   timestamptz,
    finished_at  timestamptz
);

CREATE INDEX IF NOT EXISTS agent_jobs_project_idx ON agent_jobs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_jobs_issue_idx ON agent_jobs (issue_id);

CREATE TABLE IF NOT EXISTS agent_job_logs (
    id         bigserial PRIMARY KEY,
    job_id     uuid NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    level      text NOT NULL DEFAULT 'info' CHECK (level IN ('info','thinking','output','error')),
    message    text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_job_logs_job_idx ON agent_job_logs (job_id, id);

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['agent_jobs', 'agent_job_logs'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I FOR ALL '
            'USING (karkhana_project_ok(project_id)) WITH CHECK (true)', t);
    END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON agent_jobs TO "{{APP_ROLE}}";
GRANT SELECT, INSERT ON agent_job_logs TO "{{APP_ROLE}}";
GRANT USAGE, SELECT ON SEQUENCE agent_job_logs_id_seq TO "{{APP_ROLE}}";
