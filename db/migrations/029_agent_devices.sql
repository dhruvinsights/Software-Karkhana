-- 029_agent_devices.sql
-- Developer machines running the karkhana-agent CLI. A machine pairs once
-- with a short-lived code and then holds a long-lived device token; only the
-- SHA-256 of each secret is stored. Machines dial out to claim work, so no
-- inbound port is ever opened on a laptop.
--
-- A build that runs on a machine is an `agent_jobs` row (026) tied to the run
-- it executes; its live log goes to `agent_job_logs`.

CREATE TABLE IF NOT EXISTS agent_devices (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name               text NOT NULL,
    platform           text NOT NULL DEFAULT '',
    harness            text NOT NULL DEFAULT '',
    token_hash         text UNIQUE,
    pairing_hash       text UNIQUE,
    pairing_expires_at timestamptz,
    status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
    last_seen_at       timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_devices_user ON agent_devices (user_id, status);

ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES agent_devices(id) ON DELETE SET NULL;
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES runs(id) ON DELETE CASCADE;
ALTER TABLE agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_engine_check;
ALTER TABLE agent_jobs ADD CONSTRAINT agent_jobs_engine_check
    CHECK (engine IN ('ollama', 'bob', 'claude', 'gemini'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_jobs_run ON agent_jobs (run_id) WHERE run_id IS NOT NULL;
-- The claim query: oldest queued job for one device.
CREATE INDEX IF NOT EXISTS idx_agent_jobs_claim ON agent_jobs (device_id, created_at) WHERE status = 'queued';

ALTER TABLE agent_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_only ON agent_devices;
CREATE POLICY owner_only ON agent_devices FOR ALL
    USING (karkhana_rls_user() IS NULL OR user_id = karkhana_rls_user()) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON agent_devices TO "{{APP_ROLE}}";
