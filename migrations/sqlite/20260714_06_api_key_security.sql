ALTER TABLE tokens ADD COLUMN public_id TEXT NOT NULL DEFAULT '';
ALTER TABLE tokens ADD COLUMN key_prefix TEXT NOT NULL DEFAULT '';
ALTER TABLE tokens ADD COLUMN key_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE tokens ADD COLUMN legacy_lookup_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE tokens ADD COLUMN last_four TEXT NOT NULL DEFAULT '';
ALTER TABLE tokens ADD COLUMN key_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tokens ADD COLUMN scopes TEXT NOT NULL DEFAULT '';
ALTER TABLE tokens ADD COLUMN revoked_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tokens ADD COLUMN migrated_at INTEGER NOT NULL DEFAULT 0;

UPDATE tokens
SET key_prefix = substr("key", 1, 12),
    last_four = substr("key", -4)
WHERE key_version = 0
  AND "key" <> ''
  AND key_prefix = ''
  AND last_four = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_public_id_unique
  ON tokens(public_id) WHERE public_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_legacy_lookup_unique
  ON tokens(legacy_lookup_hash) WHERE legacy_lookup_hash <> '';
CREATE INDEX IF NOT EXISTS idx_tokens_security_state
  ON tokens(user_id, status, revoked_at, expired_time);
