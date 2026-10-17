-- 022_idea_lab.sql
-- Idea Lab: codebase scans, agent ideas, multi-turn AI chat history per product and
-- idea evaluation reports. Reviewer decisions live in idea_approvals (010).

CREATE TABLE IF NOT EXISTS idea_scans (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'running',  -- running | done | failed
    provider      TEXT NOT NULL DEFAULT 'ollama',
    model         TEXT NOT NULL,
    repo_url      TEXT NOT NULL,
    started_by    UUID REFERENCES users(id),
    stats         JSONB NOT NULL DEFAULT '{}'::jsonb,
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_idea_scans_product ON idea_scans (product_id, created_at DESC);

-- Enrich ideas table
ALTER TABLE ideas
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'agent'
    ADD COLUMN IF NOT EXISTS scan_id UUID REFERENCES idea_scans(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS review_report JSONB;

-- Multi-turn brainstorming chat history per user and product
CREATE TABLE IF NOT EXISTS idea_chats (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_id       UUID REFERENCES ideas(id) ON DELETE SET NULL,
    product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    provider      TEXT NOT NULL DEFAULT 'ollama',
    model         TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idea_chats_product_user ON idea_chats (product_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS idea_chat_messages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id       UUID NOT NULL REFERENCES idea_chats(id) ON DELETE CASCADE,
    role          TEXT NOT NULL, -- 'user' | 'assistant'
    content       TEXT NOT NULL,
    thinking      TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idea_chat_messages_chat ON idea_chat_messages (chat_id, created_at ASC);

-- Earlier builds created our own review queue; the approval flow replaced it.
ALTER TABLE ideas DROP COLUMN IF EXISTS review_status;
DROP TABLE IF EXISTS idea_reviews;

-- Row-level security, the same second line of tenant isolation as 017.
ALTER TABLE idea_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON idea_scans;
CREATE POLICY tenant_isolation ON idea_scans FOR ALL
    USING (karkhana_ws_ok(workspace_id)) WITH CHECK (true);

ALTER TABLE idea_chats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON idea_chats;
CREATE POLICY tenant_isolation ON idea_chats FOR ALL
    USING (karkhana_ws_ok(workspace_id)) WITH CHECK (true);

ALTER TABLE idea_chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON idea_chat_messages;
CREATE POLICY tenant_isolation ON idea_chat_messages FOR ALL
    USING (karkhana_rls_user() IS NULL
           OR EXISTS (SELECT 1 FROM idea_chats c WHERE c.id = idea_chat_messages.chat_id))
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON idea_scans, idea_chats, idea_chat_messages TO "{{APP_ROLE}}";
