#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -n "${DB_TYPE:-}" ]] || fail "required environment variable is missing: DB_TYPE"

case "$(printf '%s' "$DB_TYPE" | tr '[:upper:]' '[:lower:]')" in
mysql)
  command -v mysql >/dev/null 2>&1 || fail "required command not found: mysql"
  [[ -n "${MYSQL_HOST:-}" ]] || fail "required environment variable is missing: MYSQL_HOST"
  [[ -n "${MYSQL_USER:-}" ]] || fail "required environment variable is missing: MYSQL_USER"
  [[ -n "${MYSQL_DATABASE:-}" ]] || fail "required environment variable is missing: MYSQL_DATABASE"
  mysql --batch --skip-column-names \
    --host="$MYSQL_HOST" --port="${MYSQL_PORT:-3306}" \
    --user="$MYSQL_USER" "$MYSQL_DATABASE" <<'SQL'
SELECT
  SUM(CASE WHEN key_version = 0 AND revoked_at = 0 THEN 1 ELSE 0 END) AS remaining_legacy,
  SUM(CASE WHEN key_version = 1 AND migrated_at > 0 THEN 1 ELSE 0 END) AS migrated_or_hashed,
  SUM(CASE WHEN revoked_at > 0 OR status <> 1 THEN 1 ELSE 0 END) AS revoked_or_disabled
FROM tokens;
SQL
  ;;
postgres | postgresql)
  command -v psql >/dev/null 2>&1 || fail "required command not found: psql"
  [[ -n "${PGDATABASE:-}" ]] || fail "required environment variable is missing: PGDATABASE"
  psql -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  COUNT(*) FILTER (WHERE key_version = 0 AND revoked_at = 0) AS remaining_legacy,
  COUNT(*) FILTER (WHERE key_version = 1 AND migrated_at > 0) AS migrated_or_hashed,
  COUNT(*) FILTER (WHERE revoked_at > 0 OR status <> 1) AS revoked_or_disabled
FROM tokens;
SQL
  ;;
sqlite | sqlite3)
  command -v sqlite3 >/dev/null 2>&1 || fail "required command not found: sqlite3"
  [[ -n "${SQLITE_PATH:-}" ]] || fail "required environment variable is missing: SQLITE_PATH"
  sqlite3 -header "$SQLITE_PATH" <<'SQL'
SELECT
  SUM(CASE WHEN key_version = 0 AND revoked_at = 0 THEN 1 ELSE 0 END) AS remaining_legacy,
  SUM(CASE WHEN key_version = 1 AND migrated_at > 0 THEN 1 ELSE 0 END) AS migrated_or_hashed,
  SUM(CASE WHEN revoked_at > 0 OR status <> 1 THEN 1 ELSE 0 END) AS revoked_or_disabled
FROM tokens;
SQL
  ;;
*)
  fail "DB_TYPE must be mysql, postgres, or sqlite"
  ;;
esac
