-- 015_rag_pgvector_compression.sql
-- 1. RAG knowledge base in Postgres (pgvector), scoped to one workspace per row.
--    Replaces the in-memory list + FAISS index in app/routers/rag.py, which was
--    lost on restart and shared by every tenant in the process.
-- 2. Headroom context-compression accounting on agent runs.

CREATE TABLE IF NOT EXISTS rag_documents (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id    uuid REFERENCES projects(id) ON DELETE CASCADE,
    title         text NOT NULL,
    tags          jsonb NOT NULL DEFAULT '[]'::jsonb,
    content_chars integer NOT NULL DEFAULT 0,
    created_by    uuid REFERENCES users(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    -- Target of the composite FK below: a chunk can only belong to a document
    -- of the same workspace.
    UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS rag_documents_workspace_idx
    ON rag_documents (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rag_chunks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     uuid NOT NULL,
    -- Denormalised so every similarity query filters by tenant in SQL.
    workspace_id    uuid NOT NULL,
    chunk_index     integer NOT NULL DEFAULT 0,
    chunk_text      text NOT NULL,
    embedding       vector(768),
    embedding_model text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (document_id, workspace_id)
        REFERENCES rag_documents (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS rag_chunks_workspace_idx ON rag_chunks (workspace_id);
CREATE INDEX IF NOT EXISTS rag_chunks_document_idx ON rag_chunks (document_id);
CREATE INDEX IF NOT EXISTS rag_chunks_embed_idx
    ON rag_chunks USING hnsw (embedding vector_cosine_ops);

-- Chat history, private to one user in one workspace.
CREATE TABLE IF NOT EXISTS rag_chat_messages (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id    text NOT NULL,
    role          text NOT NULL CHECK (role IN ('user', 'assistant')),
    content       text NOT NULL,
    sources       jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS rag_chat_messages_session_idx
    ON rag_chat_messages (user_id, workspace_id, session_id, created_at);

GRANT SELECT, INSERT, DELETE ON rag_documents, rag_chunks, rag_chat_messages
    TO "{{APP_ROLE}}";

ALTER TABLE runs ADD COLUMN IF NOT EXISTS context_compression jsonb;
