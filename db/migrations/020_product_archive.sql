-- 020_product_archive.sql
-- Products are archived like projects so deleting one syncs to every member.
ALTER TABLE products ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id);
