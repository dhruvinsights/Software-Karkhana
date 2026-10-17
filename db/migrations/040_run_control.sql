-- 040_run_control.sql
-- A build is steered by the developer: `control` says where it pauses for their
-- decision, `brief` is the context they chose to give the agent, and `gate` is the
-- decision currently waiting for them (set by the agent, answered in the UI).
--   control: {"mode": "step", "pauses": ["after_code", "before_tests", "fix"]}
--   brief:   {"criteria": [0, 2], "notes": ["<id>"], "focus": ["app/x.py"], "instruction": "..."}
--   gate:    {"name": "after_code", "summary": "...", "options": [...], "decision": null | {...}}

ALTER TABLE runs ADD COLUMN IF NOT EXISTS control jsonb;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS brief jsonb;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS gate jsonb;
