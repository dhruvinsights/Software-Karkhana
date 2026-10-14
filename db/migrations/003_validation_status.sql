-- Worker completion and test outcome are different facts. runs.status says
-- whether the worker finished; validation_status says whether the tests passed.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'not_run';
DO $$ BEGIN
    ALTER TABLE runs ADD CONSTRAINT runs_validation_status_check
        CHECK (validation_status IN ('not_run', 'passed', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
