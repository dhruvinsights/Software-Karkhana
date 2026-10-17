-- 028_project_documents.sql
-- Versioned project documents written by AI and approved by people: the PRD,
-- the ERD and the design spec. `content` is the validated structured document
-- (rendered to HTML/PDF on demand); a new version is a new row, so the
-- approved version a team built against is never overwritten.

CREATE TABLE IF NOT EXISTS project_documents (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (kind IN ('prd', 'erd', 'design')),
    version      integer NOT NULL,
    title        text NOT NULL,
    content      jsonb NOT NULL,
    status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
    model        text NOT NULL,
    created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, kind, version)
);

CREATE INDEX IF NOT EXISTS idx_project_documents_latest ON project_documents (project_id, kind, version DESC);

-- Progress of the AI drafting job, shown on the project page.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS docs_status jsonb;

ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project_documents;
CREATE POLICY tenant_isolation ON project_documents FOR ALL
    USING (karkhana_project_ok(project_id)) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON project_documents TO "{{APP_ROLE}}";
