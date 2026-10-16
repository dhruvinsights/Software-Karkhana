-- 007_rag_documents_project_access.sql
-- Documents, pgvector chunks, project member roles and workspace invitations

ALTER TABLE projects ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES users(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS workspace_invites (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    inviter_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email         text,
    role          text NOT NULL DEFAULT 'developer',
    token         text NOT NULL UNIQUE,
    status        text NOT NULL DEFAULT 'pending',
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_members (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role          text NOT NULL DEFAULT 'developer',
    stations      jsonb NOT NULL DEFAULT '["product", "architecture", "developer", "qa", "devops", "security", "release"]'::jsonb,
    joined_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS product_documents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      uuid REFERENCES products(id) ON DELETE CASCADE,
    workspace_id    uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    filename        text NOT NULL,
    content_type    text NOT NULL DEFAULT 'text/plain',
    extracted_text  text NOT NULL DEFAULT '',
    parsed_spec     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_document_chunks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     uuid NOT NULL REFERENCES product_documents(id) ON DELETE CASCADE,
    product_id      uuid REFERENCES products(id) ON DELETE CASCADE,
    chunk_index     integer NOT NULL DEFAULT 0,
    chunk_text      text NOT NULL,
    embedding       vector(768),
    embedding_model text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_doc_chunks_embed_idx ON product_document_chunks USING hnsw (embedding vector_cosine_ops);

GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_invites, project_members, product_documents, product_document_chunks TO "{{APP_ROLE}}";
