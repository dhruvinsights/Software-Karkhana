-- 017_row_level_security.sql
-- Postgres row-level security: the second line of tenant isolation, behind
-- the application's own WHERE clauses (app/access.py).
--
-- How it works
--   * Every authenticated request sets the transaction-local setting
--     karkhana.user_id (app/db.py: bind_rls_user, re-applied at the start of
--     every transaction in the request's session).
--   * Policies admit a row when its workspace is one the user is a member of
--     (or created). Workspace membership is read live, so a workspace created
--     or joined earlier in the same request is visible immediately.
--   * Rows without a workspace (legacy single-tenant projects, platform
--     ledger events) stay visible: they predate tenancy.
--   * With no karkhana.user_id set the session is a *system* context
--     (background evaluation, worker callbacks authenticated by run token,
--     migrations, scripts). System contexts are not restricted; they never
--     act on behalf of an end user's request.
--   * RLS applies to the least-privilege app role only. The schema owner
--     (migrations, operator scripts) bypasses it because RLS is ENABLEd, not
--     FORCEd.
--   * INSERT is not restricted here (WITH CHECK true): the app validates the
--     target workspace before writing. Reads, updates and deletes are.
--
-- Identity tables (users, workspaces, workspace_members, workspace_invites)
-- carry no policies: they define membership and are needed to accept an
-- invitation before the user is a member.

CREATE OR REPLACE FUNCTION karkhana_rls_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('karkhana.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION karkhana_ws_ok(ws uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN karkhana_rls_user() IS NULL THEN true
        WHEN ws IS NULL THEN true
        ELSE EXISTS (
                SELECT 1 FROM workspace_members m
                WHERE m.workspace_id = ws AND m.user_id = karkhana_rls_user()
            ) OR EXISTS (
                SELECT 1 FROM workspaces w
                WHERE w.id = ws AND w.created_by = karkhana_rls_user()
            )
    END
$$;

CREATE OR REPLACE FUNCTION karkhana_project_ok(pid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT karkhana_rls_user() IS NULL OR pid IS NULL OR EXISTS (
        SELECT 1 FROM projects p WHERE p.id = pid AND karkhana_ws_ok(p.workspace_id)
    )
$$;

DO $$
DECLARE
    t text;
BEGIN
    -- Tables that carry workspace_id directly.
    FOREACH t IN ARRAY ARRAY[
        'projects', 'products', 'ideas', 'product_documents', 'chat_channels',
        'activity_events', 'ledger', 'adrs', 'test_scenarios', 'security_findings',
        'rag_documents', 'rag_chunks', 'rag_chat_messages'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I FOR ALL '
            'USING (karkhana_ws_ok(workspace_id)) WITH CHECK (true)', t);
    END LOOP;

    -- Tables that hang off a project.
    FOREACH t IN ARRAY ARRAY[
        'approvals', 'context_entries', 'epics', 'evaluations', 'issues',
        'learnings', 'project_comments', 'project_members', 'runs', 'tasks'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I FOR ALL '
            'USING (karkhana_project_ok(project_id)) WITH CHECK (true)', t);
    END LOOP;
END $$;

-- One hop further: pull requests via their task, review comments via their
-- PR, chat messages via their channel, idea approvals via their idea,
-- document chunks via their document. The inner tables are themselves
-- filtered, so EXISTS over them inherits the tenant boundary.
ALTER TABLE pull_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pull_requests;
CREATE POLICY tenant_isolation ON pull_requests FOR ALL
    USING (karkhana_rls_user() IS NULL
           OR EXISTS (SELECT 1 FROM tasks t WHERE t.id = pull_requests.task_id))
    WITH CHECK (true);

ALTER TABLE review_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON review_comments;
CREATE POLICY tenant_isolation ON review_comments FOR ALL
    USING (karkhana_rls_user() IS NULL
           OR EXISTS (SELECT 1 FROM pull_requests p WHERE p.id = review_comments.pr_id))
    WITH CHECK (true);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON chat_messages;
CREATE POLICY tenant_isolation ON chat_messages FOR ALL
    USING (karkhana_rls_user() IS NULL
           OR EXISTS (SELECT 1 FROM chat_channels c WHERE c.id = chat_messages.channel_id))
    WITH CHECK (true);

ALTER TABLE idea_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON idea_approvals;
CREATE POLICY tenant_isolation ON idea_approvals FOR ALL
    USING (karkhana_rls_user() IS NULL
           OR EXISTS (SELECT 1 FROM ideas i WHERE i.id = idea_approvals.idea_id))
    WITH CHECK (true);

ALTER TABLE product_document_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON product_document_chunks;
CREATE POLICY tenant_isolation ON product_document_chunks FOR ALL
    USING (karkhana_rls_user() IS NULL
           OR EXISTS (SELECT 1 FROM product_documents d
                      WHERE d.id = product_document_chunks.document_id))
    WITH CHECK (true);

GRANT EXECUTE ON FUNCTION karkhana_rls_user(), karkhana_ws_ok(uuid),
    karkhana_project_ok(uuid) TO "{{APP_ROLE}}";
