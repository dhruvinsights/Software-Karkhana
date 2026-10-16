-- 016_stations.sql
-- Server-backed lifecycle stations: architecture decision records, QA test
-- scenarios and security findings. These replace the browser-only
-- (localStorage) lists so the whole team sees one record and every change
-- reaches the ledger. workspace_id is denormalised from the project so
-- tenant-scoped queries (and later row-level security) need no join.

CREATE TABLE IF NOT EXISTS adrs (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id         uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    number               integer NOT NULL,
    title                text NOT NULL,
    status               text NOT NULL DEFAULT 'proposed'
                         CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded')),
    context              text NOT NULL DEFAULT '',
    decision             text NOT NULL DEFAULT '',
    rationale            text NOT NULL DEFAULT '',
    consequences         jsonb NOT NULL DEFAULT '[]'::jsonb,
    affected_components  jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by           uuid NOT NULL REFERENCES users(id),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, number)
);
CREATE INDEX IF NOT EXISTS idx_adrs_workspace ON adrs (workspace_id);

CREATE TABLE IF NOT EXISTS test_scenarios (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id       uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    issue_id           uuid REFERENCES issues(id) ON DELETE SET NULL,
    title              text NOT NULL,
    type               text NOT NULL DEFAULT 'Functional'
                       CHECK (type IN ('Functional', 'Boundary', 'Security / Negative',
                                       'Performance / Load', 'Accessibility')),
    priority           text NOT NULL DEFAULT 'P1' CHECK (priority IN ('P0', 'P1', 'P2')),
    steps              jsonb NOT NULL DEFAULT '[]'::jsonb,
    expected_result    text NOT NULL DEFAULT '',
    status             text NOT NULL DEFAULT 'not_run'
                       CHECK (status IN ('not_run', 'passed', 'failed', 'blocked')),
    actual_result      text,
    evidence_uri       text,
    automation_script  text,
    created_by         uuid NOT NULL REFERENCES users(id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_test_scenarios_project ON test_scenarios (project_id, status);
CREATE INDEX IF NOT EXISTS idx_test_scenarios_workspace ON test_scenarios (workspace_id);

CREATE TABLE IF NOT EXISTS security_findings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id        uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    title               text NOT NULL,
    cve_id              text,
    cwe_category        text NOT NULL DEFAULT '',
    severity            text NOT NULL DEFAULT 'MEDIUM'
                        CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    cvss_score          numeric(3, 1) NOT NULL DEFAULT 0 CHECK (cvss_score BETWEEN 0 AND 10),
    status              text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'in_remediation', 'verified_fixed', 'waived')),
    affected_component  text NOT NULL DEFAULT '',
    remediation_advice  text NOT NULL DEFAULT '',
    sla_deadline        date,
    status_reason       text,
    created_by          uuid NOT NULL REFERENCES users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_findings_project ON security_findings (project_id, status);
CREATE INDEX IF NOT EXISTS idx_security_findings_workspace ON security_findings (workspace_id);

-- Records are edited and moved through statuses, never deleted by the app:
-- the ledger holds their history.
GRANT SELECT, INSERT, UPDATE ON adrs, test_scenarios, security_findings TO "{{APP_ROLE}}";
