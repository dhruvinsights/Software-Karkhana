-- 024_chat_attachments.sql: files, images and voice messages sent in chat.
-- Bytes live in Postgres (bytea, 10 MB cap enforced by the API), so they are
-- tenant-isolated by RLS and expire with their message (90-day retention, 023).
-- Uploads land with message_id NULL and are attached when the message is sent;
-- ones never attached are purged after a day.

CREATE TABLE IF NOT EXISTS chat_attachments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id   uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    message_id   uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
    uploader_id  uuid REFERENCES users(id) ON DELETE SET NULL,
    filename     text NOT NULL,
    content_type text NOT NULL,
    kind         text NOT NULL,          -- 'image' | 'audio' | 'file'
    size_bytes   integer NOT NULL,
    data         bytea NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_attachments_message_idx ON chat_attachments(message_id);
CREATE INDEX IF NOT EXISTS chat_attachments_orphan_idx ON chat_attachments(created_at) WHERE message_id IS NULL;

ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON chat_attachments;
CREATE POLICY tenant_isolation ON chat_attachments FOR ALL
    USING (karkhana_ws_ok(workspace_id)) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON chat_attachments TO "{{APP_ROLE}}";

CREATE OR REPLACE FUNCTION purge_expired_chat(retention_days int)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    cutoff timestamptz;
    removed integer;
BEGIN
    cutoff := now() - make_interval(days => GREATEST(retention_days, 7));

    DELETE FROM activity_events
     WHERE target_type = 'channel' AND created_at < cutoff;

    DELETE FROM chat_attachments
     WHERE message_id IS NULL AND created_at < now() - interval '1 day';

    -- Attachments go with their messages (ON DELETE CASCADE).
    DELETE FROM chat_messages WHERE created_at < cutoff;
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END;
$$;
