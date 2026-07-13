ALTER TABLE tokens
  ADD COLUMN IF NOT EXISTS public_id varchar(32) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS key_prefix varchar(32) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS key_hash char(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS legacy_lookup_hash char(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_four varchar(4) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS key_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scopes varchar(256) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS revoked_at bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS migrated_at bigint NOT NULL DEFAULT 0;

UPDATE tokens
SET key_prefix = LEFT("key", 12),
    last_four = RIGHT("key", 4)
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
