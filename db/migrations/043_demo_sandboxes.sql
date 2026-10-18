-- 043_demo_sandboxes.sql
-- Product-led onboarding: "Launch Demo" gives an anonymous visitor a private,
-- pre-built sandbox workspace without an account.
--
--   * users.is_guest marks the throwaway identity a demo runs as. Guests cannot
--     sign in with a password, invite people, connect GitHub, pair machines or
--     create workspaces; their session ends when the demo is claimed or expires.
--   * workspaces.is_sandbox marks the demo workspace. Its data (and its ledger
--     chain, which is per workspace) never mixes with a real workspace.
--   * demo_sessions ties a guest to its sandbox and records who claimed it.
--   * user_onboarding keeps what a person did in the demo (tour progress, the
--     setup they chose) after they sign up, attached to their real account.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS is_sandbox boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS demo_sessions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    scenario       text NOT NULL,
    status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'claimed', 'expired')),
    -- SHA-256 of the client address: enough to rate-limit, not enough to identify.
    client_hash    text NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz NOT NULL,
    claimed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
    claimed_at     timestamptz
);
CREATE INDEX IF NOT EXISTS demo_sessions_client_idx ON demo_sessions (client_hash, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS demo_sessions_guest_idx ON demo_sessions (guest_user_id);

CREATE TABLE IF NOT EXISTS user_onboarding (
    user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    demo_session_id  uuid REFERENCES demo_sessions(id) ON DELETE SET NULL,
    -- {"completed": [...step ids], "lastStep": "...", "finishedAt": "...", "skipped": bool}
    tour             jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- What they told us while exploring: use case, team size, intent.
    profile          jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Ideas they wrote in the demo, copied out at claim time (never seeded data).
    drafts           jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Identity tables: no RLS (like users / workspaces). The API reads them only
-- for the signed-in user.
GRANT SELECT, INSERT, UPDATE ON demo_sessions TO "{{APP_ROLE}}";
GRANT SELECT, INSERT, UPDATE ON user_onboarding TO "{{APP_ROLE}}";
