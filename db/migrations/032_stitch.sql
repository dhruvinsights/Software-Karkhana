-- 032_stitch.sql
-- Google Stitch on the designer dashboard. Each Karkhana project gets at most
-- one Stitch project; screens Stitch generates are copied here (HTML and a
-- screenshot) so the design survives Stitch link expiry and is part of the
-- project record. Jobs track the slow generate/edit/variant calls, enforce one
-- at a time per project, and are what the per-workspace daily quota counts.

CREATE TABLE IF NOT EXISTS stitch_projects (
    project_id        uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    stitch_project_id text NOT NULL CHECK (stitch_project_id ~ '^[0-9A-Za-z_-]{1,64}$'),
    created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stitch_jobs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (kind IN ('generate', 'edit', 'variants', 'sync')),
    status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
    prompt       text NOT NULL DEFAULT '',
    params       jsonb NOT NULL DEFAULT '{}'::jsonb,
    result       jsonb NOT NULL DEFAULT '{}'::jsonb,
    error        text,
    created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz
);

-- One running job per project, enforced by the database (no check-then-insert race).
CREATE UNIQUE INDEX IF NOT EXISTS stitch_jobs_one_running
    ON stitch_jobs (project_id) WHERE status = 'running';
-- The quota query: generations per workspace in the last 24 hours.
CREATE INDEX IF NOT EXISTS stitch_jobs_workspace_recent
    ON stitch_jobs (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stitch_screens (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stitch_screen_id    text NOT NULL CHECK (stitch_screen_id ~ '^[0-9A-Za-z_-]{1,128}$'),
    job_id              uuid REFERENCES stitch_jobs(id) ON DELETE SET NULL,
    parent_id           uuid REFERENCES stitch_screens(id) ON DELETE SET NULL,
    title               text NOT NULL DEFAULT 'Untitled screen',
    prompt              text NOT NULL DEFAULT '',
    device_type         text,
    width               integer,
    height              integer,
    html                text,
    screenshot          bytea,
    screenshot_type     text CHECK (screenshot_type IS NULL OR screenshot_type IN ('image/png', 'image/jpeg', 'image/webp')),
    pinned              boolean NOT NULL DEFAULT false,
    archived_at         timestamptz,
    created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, stitch_screen_id)
);

CREATE INDEX IF NOT EXISTS stitch_screens_project ON stitch_screens (project_id, created_at DESC);

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['stitch_projects', 'stitch_jobs', 'stitch_screens'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I FOR ALL '
            'USING (karkhana_project_ok(project_id)) WITH CHECK (true)', t);
    END LOOP;
END $$;

GRANT SELECT, INSERT ON stitch_projects TO "{{APP_ROLE}}";
GRANT SELECT, INSERT, UPDATE ON stitch_jobs TO "{{APP_ROLE}}";
GRANT SELECT, INSERT, UPDATE ON stitch_screens TO "{{APP_ROLE}}";
