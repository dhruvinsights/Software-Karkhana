-- 008_chat.sql: Real-time chat channels, messages, project comments, activity feed
-- All tables are workspace-scoped. Messages are append-only.

-- ── Chat channels (public #channels + DM threads) ────────────────────────────
CREATE TABLE IF NOT EXISTS chat_channels (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name        text NOT NULL,                     -- e.g. "general", "engineering"
    type        text NOT NULL DEFAULT 'channel',   -- 'channel' | 'dm'
    description text,
    created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_channels_workspace_idx ON chat_channels(workspace_id);

-- ── DM participants (only populated for type='dm') ────────────────────────────
CREATE TABLE IF NOT EXISTS chat_channel_members (
    channel_id  uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
);

-- ── Messages (append-only, never deleted) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id  uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    sender_id   uuid NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    body        text NOT NULL,
    -- JSON array of user_ids that were @mentioned: ["uuid1","uuid2"]
    mentions    jsonb NOT NULL DEFAULT '[]',
    edited_at   timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_channel_idx ON chat_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_mentions_idx ON chat_messages USING gin(mentions);

-- ── Per-user read cursor (last message seen in each channel) ──────────────────
CREATE TABLE IF NOT EXISTS chat_read_cursors (
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id  uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    last_read_message_id uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel_id)
);

-- ── Project comments (threaded comments on any project) ──────────────────────
CREATE TABLE IF NOT EXISTS project_comments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    author_id   uuid NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    body        text NOT NULL,
    mentions    jsonb NOT NULL DEFAULT '[]',
    edited_at   timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_comments_project_idx ON project_comments(project_id, created_at);
CREATE INDEX IF NOT EXISTS project_comments_mentions_idx ON project_comments USING gin(mentions);

-- ── Activity feed (mentions, comments, approvals, PR events) ─────────────────
CREATE TABLE IF NOT EXISTS activity_events (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    -- recipient: NULL means broadcast to all workspace members
    recipient_id uuid REFERENCES users(id) ON DELETE CASCADE,
    type         text NOT NULL,   -- 'mention'|'comment'|'review'|'approval'|'run_complete'|'pr_merged'
    summary      text NOT NULL,
    target_type  text,            -- 'project'|'pr'|'channel'|'task'
    target_id    text,
    project_id   uuid REFERENCES projects(id) ON DELETE CASCADE,
    read         boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_events_recipient_idx ON activity_events(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_workspace_idx ON activity_events(workspace_id, created_at DESC);

-- ── Seed the default #general channel for every existing workspace ────────────
INSERT INTO chat_channels (workspace_id, name, type, description)
SELECT id, 'general', 'channel', 'Workspace-wide announcements and discussions'
FROM workspaces
ON CONFLICT DO NOTHING;
