-- Migration 013: GitHub OAuth tokens are encrypted at rest.
--
-- github_tokens.token now holds "fernet:v1:<ciphertext>" written by
-- app/crypto.py, never the raw token. Rows written before this migration (if
-- any) are plaintext; app.scripts.reencrypt_tokens encrypts them and then
-- validates the constraint below.

COMMENT ON COLUMN github_tokens.token IS
    'Encrypted OAuth token: "fernet:v1:<fernet token>" (app/crypto.py). Never plaintext.';

ALTER TABLE github_tokens
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Every new or updated row must carry a ciphertext version tag. NOT VALID so
-- legacy plaintext rows do not block the migration; the re-encrypt script runs
-- VALIDATE CONSTRAINT once they are fixed.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'github_tokens_token_encrypted'
    ) THEN
        ALTER TABLE github_tokens
            ADD CONSTRAINT github_tokens_token_encrypted
            CHECK (token LIKE 'fernet:v1:%') NOT VALID;
    END IF;
END $$;

-- The app stores, rotates and disconnects a user's own token.
GRANT SELECT, INSERT, UPDATE, DELETE ON github_tokens TO "{{APP_ROLE}}";
