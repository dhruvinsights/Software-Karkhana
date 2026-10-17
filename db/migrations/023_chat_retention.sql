-- 023_chat_retention.sql: chat history is kept for a fixed window (90 days by
-- default, CHAT_RETENTION_DAYS), then purged. Supersedes "never deleted" in 008.
--
-- chat_messages has row-level security, so the app role cannot see other
-- tenants' rows. The purge runs through a SECURITY DEFINER function owned by
-- the schema owner; it only deletes by age and accepts no other input.

CREATE INDEX IF NOT EXISTS chat_messages_created_idx ON chat_messages(created_at);

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
    -- Floor of 7 days so a bad setting cannot wipe live conversations.
    cutoff := now() - make_interval(days => GREATEST(retention_days, 7));

    DELETE FROM activity_events
     WHERE target_type = 'channel' AND created_at < cutoff;

    DELETE FROM chat_messages WHERE created_at < cutoff;
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_chat(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_chat(int) TO "{{APP_ROLE}}";
