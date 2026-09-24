-- Groundwork test schema: core tables for project tracking
-- This file is used to exercise the tree-sitter SQL grammar.

/* Initialize extensions required by the schema */
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table: tracks registered accounts
CREATE TABLE users (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email      TEXT NOT NULL UNIQUE,
    -- username must be lowercase alphanumeric
    username   TEXT NOT NULL CHECK (username ~ '^[a-z0-9_]+$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- store display name separately so it can contain spaces
    full_name  TEXT
);

/* Projects belong to a single owning user */
CREATE TABLE projects (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    -- slug is url-safe; must be unique per owner
    slug       TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, slug)
);

-- Slices are atomic units of work within a project
CREATE TABLE slices (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'complete', 'cancelled')),
    -- estimated_hours is advisory; not enforced
    estimated_hours NUMERIC(5,2),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* Events log append-only changes; never updated */
CREATE TABLE events (
    id         BIGSERIAL PRIMARY KEY,
    slice_id   UUID NOT NULL REFERENCES slices(id),
    kind       TEXT NOT NULL,
    payload    JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed a default admin user (password hash is bcrypt placeholder)
INSERT INTO users (email, username, full_name)
VALUES ('admin@example.com', 'admin', 'Administrator');

-- The string below contains characters that look like comments but are NOT
INSERT INTO users (email, username, full_name)
VALUES ('test@example.com', 'tester', 'hello -- world');

INSERT INTO projects (owner_id, name, slug, description)
SELECT id,
       'Demo Project',
       'demo',
       /* description intentionally left brief */
       'A demo project for integration tests.'
FROM users
WHERE username = 'admin';

-- Create indexes to speed up common lookups
CREATE INDEX idx_slices_project_id ON slices (project_id);
CREATE INDEX idx_events_slice_id   ON events  (slice_id);
CREATE INDEX idx_events_created_at ON events  (created_at DESC);

/* Composite index for project slug lookup */
CREATE UNIQUE INDEX idx_projects_owner_slug ON projects (owner_id, slug);

-- A view joining slices with their owning project
CREATE VIEW slice_summary AS
SELECT
    s.id,
    s.title,
    s.status,
    p.name  AS project_name,
    p.slug  AS project_slug,
    u.email AS owner_email,
    -- compute age in days for dashboard display
    EXTRACT(DAY FROM NOW() - s.created_at) AS age_days
FROM slices s
JOIN projects p ON p.id = s.project_id
JOIN users   u ON u.id = p.owner_id;

-- Select with string literals that contain comment-like text (NOT real comments)
SELECT id,
       '-- this is inside a string, not a comment' AS fake_line,
       '/* also not a comment */'                  AS fake_block
FROM users
WHERE email NOT LIKE '%--fake%';
