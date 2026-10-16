-- 021_product_setup_reviewers.sql
-- Product setup details (personas, stack, repo, team spaces) and the reviewer access level.

-- settings: problemStatement, targetUsers, techStack[], repositoryUrl, keyFeatures[],
-- constraints[], teamSpaces[] (station ids this product's projects use).
ALTER TABLE products ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- reviewer: a senior who reviews and decides ideas and sees a read-only project overview.
ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS workspace_members_access_check;
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_access_check
    CHECK (access IN ('owner', 'admin', 'reviewer', 'guide', 'member'));
