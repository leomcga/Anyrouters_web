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
mode="${PERMISSION_MODE:-print}"
[[ "$mode" == "print" || "$mode" == "apply" ]] ||
  fail "PERMISSION_MODE must be print or apply"

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

  sql=$(cat <<SQL
-- Run with the migration/admin account, never the application account.
REVOKE IF EXISTS UPDATE, DELETE, ALTER, DROP, INDEX, CREATE, REFERENCES, TRIGGER
  ON \`${database}\`.\`billing_ledgers\` FROM '${app_user}'@'${app_host}';
GRANT SELECT, INSERT
  ON \`${database}\`.\`billing_ledgers\` TO '${app_user}'@'${app_host}';
SQL
)
  if [[ "$mode" == "apply" ]]; then
    command -v mysql >/dev/null 2>&1 || fail "mysql client is required"
    printf '%s\n' "$sql" | mysql \
      --host="${MYSQL_HOST:?MYSQL_HOST is required}" \
      --port="${MYSQL_PORT:-3306}" \
      --user="${MYSQL_USER:?MYSQL_USER is required}"
  else
    printf '%s\n' "$sql"
  fi
  ;;
postgres | postgresql)
  schema="${DB_SCHEMA:-public}"
  app_role="${APP_DB_ROLE:-}"
  [[ -n "$app_role" ]] || fail "APP_DB_ROLE is required for PostgreSQL"
  validate_identifier "DB_SCHEMA" "$schema"
  validate_identifier "APP_DB_ROLE" "$app_role"

  sql=$(cat <<SQL
-- Run with the migration/admin role, never the application role.
REVOKE ALL PRIVILEGES ON TABLE "${schema}"."billing_ledgers" FROM "${app_role}";
GRANT SELECT, INSERT ON TABLE "${schema}"."billing_ledgers" TO "${app_role}";
SQL
)
  if [[ "$mode" == "apply" ]]; then
    command -v psql >/dev/null 2>&1 || fail "psql client is required"
    printf '%s\n' "$sql" | psql \
      --host="${PGHOST:?PGHOST is required}" \
      --port="${PGPORT:-5432}" \
      --username="${PGUSER:?PGUSER is required}" \
      --dbname="${PGDATABASE:?PGDATABASE is required}" \
      --set=ON_ERROR_STOP=1
  else
    printf '%s\n' "$sql"
  fi
  ;;
*)
  fail "DB_ENGINE must be mysql or postgres"
  ;;
esac
