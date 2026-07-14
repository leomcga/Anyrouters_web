ALTER TABLE tokens
  ADD COLUMN public_id VARCHAR(32) NOT NULL DEFAULT '',
  ADD COLUMN key_prefix VARCHAR(32) NOT NULL DEFAULT '',
  ADD COLUMN key_hash CHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN legacy_lookup_hash CHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN last_four VARCHAR(4) NOT NULL DEFAULT '',
  ADD COLUMN key_version INT NOT NULL DEFAULT 0,
  ADD COLUMN scopes VARCHAR(256) NOT NULL DEFAULT '',
  ADD COLUMN revoked_at BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN migrated_at BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN public_id_unique VARCHAR(32)
    GENERATED ALWAYS AS (NULLIF(public_id, '')) STORED,
  ADD COLUMN legacy_lookup_hash_unique CHAR(64)
    GENERATED ALWAYS AS (NULLIF(legacy_lookup_hash, '')) STORED;

UPDATE tokens
SET key_prefix = LEFT(`key`, 12),
    last_four = RIGHT(`key`, 4)
WHERE key_version = 0
  AND `key` <> ''
  AND key_prefix = ''
  AND last_four = '';

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'tokens'
      AND index_name = 'idx_tokens_public_id_unique'
  ),
  'SELECT 1',
  'CREATE UNIQUE INDEX idx_tokens_public_id_unique ON tokens(public_id_unique)'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'tokens'
      AND index_name = 'idx_tokens_legacy_lookup_unique'
  ),
  'SELECT 1',
  'CREATE UNIQUE INDEX idx_tokens_legacy_lookup_unique ON tokens(legacy_lookup_hash_unique)'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'tokens'
      AND index_name = 'idx_tokens_security_state'
  ),
  'SELECT 1',
  'CREATE INDEX idx_tokens_security_state ON tokens(user_id, status, revoked_at, expired_time)'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
