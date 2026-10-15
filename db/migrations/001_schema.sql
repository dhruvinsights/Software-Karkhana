-- Software Karkhana: core schema. Applied by app/scripts/migrate.py as the
-- schema owner. The application connects as a different role (002_grants.sql).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL UNIQUE,
    display_name  text NOT NULL,
    -- Roles are server-side. The browser never decides what a user may do.
    role          text NOT NULL CHECK (role IN ('pm', 'director', 'developer', 'lead')),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    idea_text     text NOT NULL,
    created_by    uuid NOT NULL REFERENCES users(id),
    -- One of the 15 lifecycle stage ids in app/process.py.
    stage         text NOT NULL DEFAULT 'evaluate',
    stage_status  text NOT NULL DEFAULT 'submitted',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evaluations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        uuid NOT NULL REFERENCES projects(id),
    version           int  NOT NULL,
    payload           jsonb NOT NULL,
    model             text NOT NULL,
    memory_used       jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, version)
);

CREATE TABLE IF NOT EXISTS approvals (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL REFERENCES projects(id),
    gate        text NOT NULL,
    decision    text NOT NULL CHECK (decision IN ('approved', 'rejected')),
    reason      text,
    decided_by  uuid NOT NULL REFERENCES users(id),
    decided_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS epics (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    uuid NOT NULL REFERENCES projects(id),
    title         text NOT NULL,
    description   text NOT NULL,
    source_quote  text NOT NULL,
    position      int  NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id           uuid NOT NULL REFERENCES projects(id),
    epic_id              uuid NOT NULL REFERENCES epics(id),
    key                  text NOT NULL,
    title                text NOT NULL,
    description          text NOT NULL DEFAULT '',
    acceptance_criteria  jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- 'draft' until the director approves; then the board columns.
    status               text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'backlog', 'ready', 'in_progress', 'review', 'done')),
    assignee_id          uuid REFERENCES users(id),
    created_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         uuid NOT NULL REFERENCES tasks(id),
    project_id      uuid NOT NULL REFERENCES projects(id),
    kind            text NOT NULL DEFAULT 'code',
    backend         text NOT NULL,
    env_class       text NOT NULL DEFAULT 'standard',
    status          text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled')),
    external_id     text,
    requested_by    uuid NOT NULL REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    heartbeat_at    timestamptz,
    finished_at     timestamptz,
    phase           text,
    branch          text,
    patch           text,
    test_command    text,
    test_exit_code  int,
    test_output     text,
    error           text,
    artifacts_uri   text
);
CREATE INDEX IF NOT EXISTS runs_project_status ON runs (project_id, status);

CREATE TABLE IF NOT EXISTS pull_requests (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id       uuid NOT NULL REFERENCES tasks(id),
    run_id        uuid NOT NULL REFERENCES runs(id) UNIQUE,
    number        int  NOT NULL,
    url           text NOT NULL,
    branch        text NOT NULL,
    head_sha      text NOT NULL,
    status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'merged', 'closed')),
    tests_passed  boolean NOT NULL,
    merged_by     uuid REFERENCES users(id),
    merged_at     timestamptz
);

CREATE TABLE IF NOT EXISTS review_comments (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pr_id          uuid NOT NULL REFERENCES pull_requests(id),
    path           text NOT NULL,
    line           int,
    severity       text NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
    body           text NOT NULL,
    triage         text NOT NULL DEFAULT 'open' CHECK (triage IN ('open', 'valid', 'dismissed')),
    triage_reason  text,
    triaged_by     uuid REFERENCES users(id),
    triaged_at     timestamptz,
    -- A dismissal must carry a reason; enforced here as well as in the API.
    CONSTRAINT dismiss_needs_reason CHECK (triage <> 'dismissed' OR length(coalesce(triage_reason, '')) > 0)
);

CREATE TABLE IF NOT EXISTS learnings (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES projects(id),
    pr_id        uuid REFERENCES pull_requests(id),
    text         text NOT NULL,
    source       jsonb NOT NULL DEFAULT '{}'::jsonb,
    status       text NOT NULL DEFAULT 'unverified'
        CHECK (status IN ('unverified', 'verified', 'rejected')),
    verified_by  uuid REFERENCES users(id),
    verified_at  timestamptz,
    embedding    vector(768),
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learnings_embedding_hnsw
    ON learnings USING hnsw (embedding vector_cosine_ops);

-- Evidence ledger: append-only, hash-chained. hash = sha256(prev_hash || body).
CREATE TABLE IF NOT EXISTS ledger (
    seq           bigserial PRIMARY KEY,
    project_id    uuid REFERENCES projects(id),
    actor_id      uuid REFERENCES users(id),
    actor_label   text NOT NULL,
    actor_kind    text NOT NULL CHECK (actor_kind IN ('human', 'ai', 'system')),
    action        text NOT NULL,
    subject_type  text NOT NULL,
    subject_id    text NOT NULL,
    payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL,
    prev_hash     text NOT NULL,
    hash          text NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS ledger_project ON ledger (project_id, seq);

-- Defence in depth: even the schema owner cannot rewrite history.
CREATE OR REPLACE FUNCTION ledger_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ledger is append-only (% blocked)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS ledger_no_update_delete ON ledger;
CREATE TRIGGER ledger_no_update_delete
    BEFORE UPDATE OR DELETE ON ledger
    FOR EACH ROW EXECUTE FUNCTION ledger_is_append_only();

DROP TRIGGER IF EXISTS ledger_no_truncate ON ledger;
CREATE TRIGGER ledger_no_truncate
    BEFORE TRUNCATE ON ledger
    FOR EACH STATEMENT EXECUTE FUNCTION ledger_is_append_only();
