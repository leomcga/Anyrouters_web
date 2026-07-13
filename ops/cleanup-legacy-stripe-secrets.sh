#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

db_type="$(printf '%s' "${DB_TYPE:-}" | tr '[:upper:]' '[:lower:]')"
execute="${1:-}"

case "$db_type" in
mysql)
  sql="DELETE FROM options WHERE \`key\` IN ('StripeApiSecret', 'StripeWebhookSecret', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET');"
  ;;
postgres | postgresql | sqlite | sqlite3)
  sql="DELETE FROM options WHERE \"key\" IN ('StripeApiSecret', 'StripeWebhookSecret', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET');"
  ;;
*)
  fail "DB_TYPE must be mysql, postgres, or sqlite"
  ;;
esac

if [[ "$execute" != "--execute" ]]; then
  printf '%s\n' "$sql"
  printf 'Dry run only. Re-run with --execute and CONFIRM_DELETE_LEGACY_STRIPE_SECRETS=YES.\n' >&2
  exit 0
fi

[[ "${CONFIRM_DELETE_LEGACY_STRIPE_SECRETS:-}" == "YES" ]] ||
  fail "set CONFIRM_DELETE_LEGACY_STRIPE_SECRETS=YES to execute"

case "$db_type" in
mysql)
  for variable in MYSQL_HOST MYSQL_USER MYSQL_DATABASE; do
    [[ -n "${!variable:-}" ]] || fail "required environment variable is missing: $variable"
  done
  command -v mysql >/dev/null 2>&1 || fail "required command not found: mysql"
  mysql --host="$MYSQL_HOST" --port="${MYSQL_PORT:-3306}" --user="$MYSQL_USER" "$MYSQL_DATABASE" -e "$sql"
  ;;
postgres | postgresql)
  command -v psql >/dev/null 2>&1 || fail "required command not found: psql"
  [[ -n "${PGDATABASE:-}" ]] || fail "required environment variable is missing: PGDATABASE"
  psql -X -v ON_ERROR_STOP=1 -c "$sql"
  ;;
sqlite | sqlite3)
  command -v sqlite3 >/dev/null 2>&1 || fail "required command not found: sqlite3"
  [[ -n "${SQLITE_PATH:-}" && -f "$SQLITE_PATH" ]] || fail "SQLITE_PATH must reference an existing database"
  sqlite3 "$SQLITE_PATH" "$sql"
  ;;
esac

printf 'Legacy Stripe secret options removed. No other options were changed.\n'
