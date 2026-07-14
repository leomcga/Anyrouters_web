CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    checksum CHAR(64) NOT NULL,
    applied_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migration_locks (
    id INTEGER PRIMARY KEY,
    updated_at BIGINT NOT NULL
);

INSERT INTO schema_migration_locks (id, updated_at)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;
