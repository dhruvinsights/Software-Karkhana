-- 039_device_work_paths.sql
-- Where on a developer's machine each project's repository lives, chosen by the
-- developer in Developer -> Machines: {"<project id>": "/absolute/or/~/path"}.
-- Sent to the agent with each job; without an entry the agent uses its default folder.

ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS work_paths jsonb NOT NULL DEFAULT '{}'::jsonb;
