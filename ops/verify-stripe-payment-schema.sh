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

verify_rows() {
  local result="$1"
  local expected=6
  local count=0
  while IFS=$'\t' read -r name valid; do
    [[ -n "$name" ]] || continue
    count=$((count + 1))
    [[ "$valid" == "1" || "$valid" == "t" ]] ||
      fail "Stripe unique index is missing or invalid: $name"
  done <<<"$result"
  [[ "$count" -eq "$expected" ]] ||
    fail "Stripe schema verification returned $count checks, expected $expected"
}

require_env DB_TYPE
db_type="$(printf '%s' "$DB_TYPE" | tr '[:upper:]' '[:lower:]')"
case "$db_type" in
mysql)
  for command in mysql; do
    command -v "$command" >/dev/null 2>&1 || fail "required command not found: $command"
  done
  for variable in MYSQL_HOST MYSQL_USER MYSQL_DATABASE; do
    require_env "$variable"
  done
  mysql_args=(
    --batch --skip-column-names
    --host="$MYSQL_HOST"
    --port="${MYSQL_PORT:-3306}"
    --user="$MYSQL_USER"
    "$MYSQL_DATABASE"
  )
  result="$(mysql "${mysql_args[@]}" <<'SQL'
SELECT 'idx_stripe_payment_orders_order_no',
       COUNT(*) = 1
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'stripe_payment_orders'
  AND index_name = 'idx_stripe_payment_orders_order_no'
  AND non_unique = 0 AND column_name = 'order_no' AND seq_in_index = 1
UNION ALL
SELECT 'idx_stripe_payment_orders_session_unique',
       COUNT(*) = 1
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'stripe_payment_orders'
  AND index_name = 'idx_stripe_payment_orders_session_unique'
  AND non_unique = 0 AND column_name = 'stripe_checkout_session_unique'
  AND seq_in_index = 1
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'stripe_payment_orders'
      AND column_name = 'stripe_checkout_session_unique'
      AND LOWER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          generation_expression,
          '`', ''),
          ' ', ''),
          CHAR(9), ''),
          CHAR(10), ''),
          '_utf8mb4', ''),
          '_utf8', ''),
          CHAR(92), '')
      ) = 'nullif(stripe_checkout_session_id,'''')'
  )
UNION ALL
SELECT 'idx_stripe_payment_orders_intent_unique',
       COUNT(*) = 1
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'stripe_payment_orders'
  AND index_name = 'idx_stripe_payment_orders_intent_unique'
  AND non_unique = 0 AND column_name = 'stripe_payment_intent_unique'
  AND seq_in_index = 1
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'stripe_payment_orders'
      AND column_name = 'stripe_payment_intent_unique'
      AND LOWER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          generation_expression,
          '`', ''),
          ' ', ''),
          CHAR(9), ''),
          CHAR(10), ''),
          '_utf8mb4', ''),
          '_utf8', ''),
          CHAR(92), '')
      ) = 'nullif(stripe_payment_intent_id,'''')'
  )
UNION ALL
SELECT 'idx_stripe_webhook_events_event_id',
       COUNT(*) = 1
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'stripe_webhook_events'
  AND index_name = 'idx_stripe_webhook_events_event_id'
  AND non_unique = 0 AND column_name = 'stripe_event_id' AND seq_in_index = 1
UNION ALL
SELECT 'idx_payment_credit_ledgers_operation_key',
       COUNT(*) = 1
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'payment_credit_ledgers'
  AND index_name = 'idx_payment_credit_ledgers_operation_key'
  AND non_unique = 0 AND column_name = 'operation_key' AND seq_in_index = 1
UNION ALL
SELECT 'idx_payment_credit_ledgers_order_no',
       COUNT(*) = 1
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'payment_credit_ledgers'
  AND index_name = 'idx_payment_credit_ledgers_order_no'
  AND non_unique = 0 AND column_name = 'order_no' AND seq_in_index = 1;
SQL
)"
  verify_rows "$result"
  ;;
postgres | postgresql)
  command -v psql >/dev/null 2>&1 || fail "required command not found: psql"
  require_env PGDATABASE
  result="$(psql -X -A -t -F $'\t' -v ON_ERROR_STOP=1 <<'SQL'
WITH required(name, table_name, column_name, partial) AS (
  VALUES
    ('idx_stripe_payment_orders_order_no', 'stripe_payment_orders', 'order_no', false),
    ('idx_stripe_payment_orders_session_unique', 'stripe_payment_orders', 'stripe_checkout_session_id', true),
    ('idx_stripe_payment_orders_intent_unique', 'stripe_payment_orders', 'stripe_payment_intent_id', true),
    ('idx_stripe_webhook_events_event_id', 'stripe_webhook_events', 'stripe_event_id', false),
    ('idx_payment_credit_ledgers_operation_key', 'payment_credit_ledgers', 'operation_key', false),
    ('idx_payment_credit_ledgers_order_no', 'payment_credit_ledgers', 'order_no', false)
)
SELECT required.name,
       (
         indexdef ILIKE '%CREATE UNIQUE INDEX%'
         AND indexdef ILIKE '%(' || required.column_name || ')%'
         AND (
           NOT required.partial
           OR (
             indexdef ILIKE '% WHERE %'
             AND indexdef ILIKE '%' || required.column_name || '%<>%'
           )
         )
       )::int
FROM required
LEFT JOIN pg_indexes
  ON schemaname = current_schema()
 AND tablename = required.table_name
 AND indexname = required.name
ORDER BY required.name;
SQL
)"
  verify_rows "$result"
  ;;
sqlite | sqlite3)
  command -v sqlite3 >/dev/null 2>&1 || fail "required command not found: sqlite3"
  require_env SQLITE_PATH
  [[ -f "$SQLITE_PATH" ]] || fail "SQLite database does not exist: $SQLITE_PATH"
  result="$(sqlite3 -batch -noheader -separator $'\t' "$SQLITE_PATH" <<'SQL'
WITH required(name, table_name, column_name, partial) AS (
  VALUES
    ('idx_stripe_payment_orders_order_no', 'stripe_payment_orders', 'order_no', 0),
    ('idx_stripe_payment_orders_session_unique', 'stripe_payment_orders', 'stripe_checkout_session_id', 1),
    ('idx_stripe_payment_orders_intent_unique', 'stripe_payment_orders', 'stripe_payment_intent_id', 1),
    ('idx_stripe_webhook_events_event_id', 'stripe_webhook_events', 'stripe_event_id', 0),
    ('idx_payment_credit_ledgers_operation_key', 'payment_credit_ledgers', 'operation_key', 0),
    ('idx_payment_credit_ledgers_order_no', 'payment_credit_ledgers', 'order_no', 0)
)
SELECT required.name,
       CASE WHEN EXISTS (
         SELECT 1
         FROM pragma_index_list(required.table_name) indexes
         JOIN pragma_index_info(required.name) columns ON columns.seqno = 0
         LEFT JOIN sqlite_master definitions
           ON definitions.type = 'index' AND definitions.name = required.name
         WHERE indexes.name = required.name
           AND indexes."unique" = 1
           AND columns.name = required.column_name
           AND (
             required.partial = 0
             OR (
               indexes.partial = 1
               AND lower(replace(definitions.sql, ' ', '')) LIKE
                 '%where' || required.column_name || '<>''''%'
             )
           )
       ) THEN 1 ELSE 0 END
FROM required
ORDER BY required.name;
SQL
)"
  verify_rows "$result"
  ;;
*)
  fail "DB_TYPE must be mysql, postgres, or sqlite"
  ;;
esac

printf 'Stripe payment schema verification passed for %s.\n' "$db_type"
