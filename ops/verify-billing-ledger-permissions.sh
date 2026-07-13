#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

validate_identifier() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
    fail "$name must match [A-Za-z_][A-Za-z0-9_]*"
}

validate_mysql_account_part() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^[A-Za-z0-9_.%@-]+$ ]] ||
    fail "$name contains unsupported characters"
}

engine="${DB_ENGINE:-${1:-}}"
dry_run="${DRY_RUN:-0}"

case "$engine" in
mysql)
  database="${DB_NAME:-}"
  app_user="${APP_DB_USER:-}"
  app_host="${APP_DB_HOST:-%}"
  [[ -n "$database" && -n "$app_user" ]] ||
    fail "DB_NAME and APP_DB_USER are required for MySQL"
  validate_identifier "DB_NAME" "$database"
  validate_mysql_account_part "APP_DB_USER" "$app_user"
  validate_mysql_account_part "APP_DB_HOST" "$app_host"
  grantee="'${app_user}'@'${app_host}'"

  query=$(cat <<SQL
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES
    WHERE GRANTEE = '${grantee}'
      AND TABLE_SCHEMA = '${database}'
      AND TABLE_NAME = 'billing_ledgers'
      AND PRIVILEGE_TYPE = 'SELECT') AS has_select,
  (SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES
    WHERE GRANTEE = '${grantee}'
      AND TABLE_SCHEMA = '${database}'
      AND TABLE_NAME = 'billing_ledgers'
      AND PRIVILEGE_TYPE = 'INSERT') AS has_insert,
  (SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES
    WHERE GRANTEE = '${grantee}'
      AND TABLE_SCHEMA = '${database}'
      AND TABLE_NAME = 'billing_ledgers'
      AND PRIVILEGE_TYPE NOT IN ('SELECT', 'INSERT')) AS forbidden_table,
  (SELECT COUNT(*) FROM information_schema.SCHEMA_PRIVILEGES
    WHERE GRANTEE = '${grantee}'
      AND TABLE_SCHEMA = '${database}'
      AND PRIVILEGE_TYPE IN ('UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'INDEX', 'TRIGGER')) AS forbidden_schema,
  (SELECT COUNT(*) FROM information_schema.USER_PRIVILEGES
    WHERE GRANTEE = '${grantee}'
      AND PRIVILEGE_TYPE NOT IN ('USAGE')) AS forbidden_global;
SQL
)
  if [[ "$dry_run" == "1" ]]; then
    printf '%s\n' "$query"
    exit 0
  fi
  command -v mysql >/dev/null 2>&1 || fail "mysql client is required"
  result=$(mysql --batch --skip-column-names \
    --host="${MYSQL_HOST:?MYSQL_HOST is required}" \
    --port="${MYSQL_PORT:-3306}" \
    --user="${MYSQL_USER:?MYSQL_USER is required}" \
    --execute="$query")
  read -r has_select has_insert forbidden_table forbidden_schema forbidden_global <<<"$result"
  [[ "$has_select" -ge 1 && "$has_insert" -ge 1 ]] ||
    fail "application account lacks SELECT or INSERT on billing_ledgers"
  [[ "$forbidden_table" == "0" && "$forbidden_schema" == "0" && "$forbidden_global" == "0" ]] ||
    fail "application account has write/admin privileges that can modify billing_ledgers"
  ;;
postgres | postgresql)
  schema="${DB_SCHEMA:-public}"
  app_role="${APP_DB_ROLE:-}"
  [[ -n "$app_role" ]] || fail "APP_DB_ROLE is required for PostgreSQL"
  validate_identifier "DB_SCHEMA" "$schema"
  validate_identifier "APP_DB_ROLE" "$app_role"

  query=$(cat <<SQL
SELECT
  has_table_privilege('${app_role}', '"${schema}"."billing_ledgers"', 'SELECT')::int,
  has_table_privilege('${app_role}', '"${schema}"."billing_ledgers"', 'INSERT')::int,
  (
    has_table_privilege('${app_role}', '"${schema}"."billing_ledgers"', 'UPDATE')
    OR has_table_privilege('${app_role}', '"${schema}"."billing_ledgers"', 'DELETE')
    OR has_table_privilege('${app_role}', '"${schema}"."billing_ledgers"', 'TRUNCATE')
    OR has_table_privilege('${app_role}', '"${schema}"."billing_ledgers"', 'REFERENCES')
    OR has_table_privilege('${app_role}', '"${schema}"."billing_ledgers"', 'TRIGGER')
  )::int,
  (SELECT rolsuper::int FROM pg_roles WHERE rolname = '${app_role}'),
  (SELECT pg_has_role('${app_role}', tableowner, 'MEMBER')::int
     FROM pg_tables
    WHERE schemaname = '${schema}' AND tablename = 'billing_ledgers');
SQL
)
  if [[ "$dry_run" == "1" ]]; then
    printf '%s\n' "$query"
    exit 0
  fi
  command -v psql >/dev/null 2>&1 || fail "psql client is required"
  result=$(psql \
    --host="${PGHOST:?PGHOST is required}" \
    --port="${PGPORT:-5432}" \
    --username="${PGUSER:?PGUSER is required}" \
    --dbname="${PGDATABASE:?PGDATABASE is required}" \
    --no-align --tuples-only --field-separator=' ' \
    --set=ON_ERROR_STOP=1 \
    --command="$query")
  read -r has_select has_insert forbidden_table is_superuser can_assume_owner <<<"$result"
  [[ "$has_select" == "1" && "$has_insert" == "1" ]] ||
    fail "application role lacks SELECT or INSERT on billing_ledgers"
  [[ "$forbidden_table" == "0" && "$is_superuser" == "0" && "$can_assume_owner" == "0" ]] ||
    fail "application role can modify billing_ledgers through privilege, ownership, or superuser bypass"
  ;;
*)
  fail "DB_ENGINE must be mysql or postgres"
  ;;
esac

printf 'billing_ledgers permissions verified for %s\n' "$engine"
