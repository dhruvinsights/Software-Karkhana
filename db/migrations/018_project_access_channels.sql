-- 018_project_access_channels.sql
-- Channel visibility and the indexes our lists rely on.

-- Station ids are app/idea_flow.py's: product, design, architecture, developer,
-- qa, devops, security, release. An earlier build of this migration renamed
-- "developer" to "development" and added "leadership"; put those rows back.
UPDATE project_members
SET stations = (
    SELECT coalesce(jsonb_agg(DISTINCT CASE WHEN s = 'development' THEN 'developer' ELSE s END), '[]'::jsonb)
    FROM jsonb_array_elements_text(stations) AS s
    WHERE s <> 'leadership'
)
WHERE stations ? 'development' OR stations ? 'leadership';

CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members(user_id);
CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects(workspace_id);

-- Channels: 'public' channels are open to every workspace member (#general);
-- 'private' channels and DMs are visible to chat_channel_members only.
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE CASCADE;
UPDATE chat_channels SET visibility = 'private' WHERE type = 'dm';
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_general_idx
    ON chat_channels(workspace_id) WHERE type = 'channel' AND name = 'general';
CREATE INDEX IF NOT EXISTS chat_channel_members_user_idx ON chat_channel_members(user_id);
CREATE INDEX IF NOT EXISTS activity_events_recipient_idx
    ON activity_events(workspace_id, recipient_id, read, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "{{APP_ROLE}}";
