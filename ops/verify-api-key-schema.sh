#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "required environment variable is missing: $name"
}

require_env DB_TYPE
db_type="$(printf '%s' "$DB_TYPE" | tr '[:upper:]' '[:lower:]')"

case "$db_type" in
mysql)
  command -v mysql >/dev/null 2>&1 || fail "required command not found: mysql"
  require_env MYSQL_HOST
  require_env MYSQL_USER
  require_env MYSQL_DATABASE
  result="$(mysql --batch --skip-column-names \
    --host="$MYSQL_HOST" --port="${MYSQL_PORT:-3306}" \
    --user="$MYSQL_USER" "$MYSQL_DATABASE" <<'SQL'
SELECT COUNT(*) = 1
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'tokens'
  AND index_name = 'idx_tokens_public_id_unique'
  AND column_name = 'public_id_unique'
  AND non_unique = 0
  AND seq_in_index = 1;
SELECT COUNT(*) = 1
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'tokens'
  AND index_name = 'idx_tokens_legacy_lookup_unique'
  AND column_name = 'legacy_lookup_hash_unique'
  AND non_unique = 0
  AND seq_in_index = 1;
SELECT COUNT(*) = 2
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'tokens'
  AND (
    (
      column_name = 'public_id_unique'
      AND LOWER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          generation_expression,
          '`', ''),
          ' ', ''),
          CHAR(9), ''),
          '_utf8mb4', ''),
          '_utf8', ''),
          CHAR(92), '')
      )
        = 'nullif(public_id,'''')'
    )
    OR (
      column_name = 'legacy_lookup_hash_unique'
      AND LOWER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          generation_expression,
          '`', ''),
          ' ', ''),
          CHAR(9), ''),
          '_utf8mb4', ''),
          '_utf8', ''),
          CHAR(92), '')
      )
        = 'nullif(legacy_lookup_hash,'''')'
    )
  );
SQL
)"
  ;;
postgres | postgresql)
  command -v psql >/dev/null 2>&1 || fail "required command not found: psql"
  require_env PGDATABASE
  result="$(psql -X -A -t -v ON_ERROR_STOP=1 <<'SQL'
SELECT COUNT(*) = 2
FROM pg_indexes
WHERE schemaname = current_schema()
  AND tablename = 'tokens'
  AND (
    (
      indexname = 'idx_tokens_public_id_unique'
      AND lower(replace(indexdef, ' ', '')) LIKE '%unique%public_id%wherepublic_id<>''''%'
    )
    OR (
      indexname = 'idx_tokens_legacy_lookup_unique'
      AND lower(replace(indexdef, ' ', '')) LIKE '%unique%legacy_lookup_hash%wherelegacy_lookup_hash<>''''%'
    )
  );
SQL
)"
  ;;
sqlite | sqlite3)
  command -v sqlite3 >/dev/null 2>&1 || fail "required command not found: sqlite3"
  require_env SQLITE_PATH
  [[ -f "$SQLITE_PATH" ]] || fail "SQLite database does not exist: $SQLITE_PATH"
  result="$(sqlite3 -batch -noheader "$SQLITE_PATH" <<'SQL'
SELECT COUNT(*) = 2
FROM sqlite_master
WHERE type = 'index'
  AND tbl_name = 'tokens'
  AND (
    (
      name = 'idx_tokens_public_id_unique'
      AND lower(replace(sql, ' ', '')) LIKE '%unique%public_id%wherepublic_id<>''''%'
    )
    OR (
      name = 'idx_tokens_legacy_lookup_unique'
      AND lower(replace(sql, ' ', '')) LIKE '%unique%legacy_lookup_hash%wherelegacy_lookup_hash<>''''%'
    )
  );
SQL
)"
  ;;
*)
  fail "DB_TYPE must be mysql, postgres, or sqlite"
  ;;
esac

while IFS= read -r valid; do
  [[ -z "$valid" || "$valid" == "1" || "$valid" == "t" ]] ||
    fail "API key schema verification failed"
done <<<"$result"
[[ -n "$result" ]] || fail "API key schema verification returned no checks"

printf 'API key schema verification passed for %s.\n' "$db_type"
