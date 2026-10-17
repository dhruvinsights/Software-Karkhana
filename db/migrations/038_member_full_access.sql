-- 038_member_full_access.sql
-- Everyone invited to a project gets every station of it by default. A product
-- manager or the project's lead can limit one person to chosen stations
-- (`limited` = true); `stations` then is their whole access. For members not
-- limited, `stations` only records which team they belong to.

ALTER TABLE project_members ADD COLUMN IF NOT EXISTS limited boolean NOT NULL DEFAULT false;
