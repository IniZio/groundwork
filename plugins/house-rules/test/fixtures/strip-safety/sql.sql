-- strip-safety: removed=9
-- source: plugins/house-rules/test/fixtures/languages/sql.sql + Postgres migration idioms
-- Groundwork schema extension: adds the audit_log table and supporting indexes.
-- migrate:up
-- +goose Up
-- +goose StatementBegin
-- name: ListAuditLog :many

/* https://www.postgresql.org/docs/current/indexes-partial.html */
/* NOTE(dba): partition audit_log by month once row count exceeds 10 million. */
/* @see schema/users.sql for the users table referenced in the foreign key. */
/* ============================================================ */

-- Adds an append-only audit_log that records every data mutation.
CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    -- row_id stores the affected row primary key serialised as text
    row_id      TEXT NOT NULL,
    table_name  TEXT NOT NULL,
    action      TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    changed_by  UUID REFERENCES users(id),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    old_data    JSONB,           -- row state before the change
    new_data    JSONB            -- row state after the change
);

/* Covering index keeps actor-filtered dashboard queries off the main heap. */
CREATE INDEX idx_audit_log_changed_by ON audit_log (changed_by);

-- Partial index covers only the 90-day hot window; older rows are archived.
CREATE INDEX idx_audit_log_recent ON audit_log (changed_at DESC)
    WHERE changed_at > NOW() - INTERVAL '90 days';

-- String literals below contain text that resembles comments but is NOT parsed as such:
INSERT INTO audit_log (table_name, row_id, action, old_data, new_data)
VALUES (
    'users',
    '00000000-0000-0000-0000-000000000001',
    'UPDATE',
    '{"note": "value -- with dashes inside a string"}',
    '{"note": "and /* braces */ are also not block comments"}'
);

SELECT al.id,
       al.table_name,
       al.action,
       al.changed_at,
       /* group before/after payloads for the diff renderer */ al.old_data,
       al.new_data,
       u.email AS changed_by_email
FROM audit_log al
LEFT JOIN users u ON u.id = al.changed_by
WHERE al.changed_at > NOW() - INTERVAL '30 days'
ORDER BY al.changed_at DESC;

SELECT /*+ INDEX(al idx_audit_log_recent) */ al.id FROM audit_log al;

-- +goose StatementEnd
-- +goose Down
-- migrate:down
DROP TABLE audit_log;
