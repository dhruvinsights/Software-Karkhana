-- 006_enterprise_auth_workspaces.sql
-- Enterprise identity, multi-tenant workspaces, products and ideas

ALTER TABLE users ADD COLUMN IF NOT EXISTS hashed_password text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;

-- Drop old role check constraint if it exists to allow full factory role taxonomy
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
    role IN (
        'pm', 'product_manager',
        'director', 'executive',
        'developer', 'lead',
        'designer', 'architect',
        'qa', 'security',
        'devops', 'release_manager',
        'support', 'admin'
    )
);

CREATE TABLE IF NOT EXISTS workspaces (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name              text NOT NULL,
    slug              text NOT NULL UNIQUE,
    domain            text,
    plan              text NOT NULL DEFAULT 'enterprise',
    security_posture  text NOT NULL DEFAULT 'STANDARD',
    created_by        uuid REFERENCES users(id),
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role              text NOT NULL,
    is_owner          boolean NOT NULL DEFAULT false,
    joined_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS products (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    name              text NOT NULL,
    code              text NOT NULL,
    domain            text NOT NULL DEFAULT 'Cloud Services',
    description       text NOT NULL DEFAULT '',
    status            text NOT NULL DEFAULT 'active',
    created_by        uuid REFERENCES users(id),
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ideas (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id        uuid REFERENCES products(id) ON DELETE CASCADE,
    workspace_id      uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    title             text NOT NULL,
    problem_statement text NOT NULL,
    target_user       text NOT NULL DEFAULT 'Enterprise Users',
    expected_value    text NOT NULL DEFAULT '',
    author_id         uuid REFERENCES users(id),
    status            text NOT NULL DEFAULT 'draft',
    complexity        text NOT NULL DEFAULT 'Medium',
    tags              jsonb NOT NULL DEFAULT '[]'::jsonb,
    assessment        jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON workspaces, workspace_members, products, ideas TO "{{APP_ROLE}}";
