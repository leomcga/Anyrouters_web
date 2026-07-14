CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    checksum CHAR(64) NOT NULL,
    applied_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migration_locks (
    id INT NOT NULL PRIMARY KEY,
    updated_at BIGINT NOT NULL
);

INSERT IGNORE INTO schema_migration_locks (id, updated_at)
VALUES (1, 0);
