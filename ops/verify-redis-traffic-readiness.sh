#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -n "${REDIS_CONN_STRING:-}" ]] ||
  fail "required environment variable is missing: REDIS_CONN_STRING"

for variable in \
  TRAFFIC_USER_RPM TRAFFIC_KEY_RPM TRAFFIC_IP_RPM \
  TRAFFIC_USER_TPM TRAFFIC_KEY_TPM TRAFFIC_IP_TPM \
  TRAFFIC_USER_MAX_CONCURRENT TRAFFIC_KEY_MAX_CONCURRENT \
  TRAFFIC_USER_DAILY_TOKENS TRAFFIC_KEY_DAILY_TOKENS \
  TRAFFIC_USER_DAILY_QUOTA CHANNEL_CIRCUIT_FAILURE_THRESHOLD \
  TRAFFIC_DEFAULT_OUTPUT_TOKENS \
  CHANNEL_CIRCUIT_OPEN_SECONDS CHANNEL_CIRCUIT_HALF_OPEN_PROBES
do
  value="${!variable:-}"
  [[ "$value" =~ ^[1-9][0-9]*$ ]] ||
    fail "$variable must be configured as a positive integer"
done

command -v redis-cli >/dev/null 2>&1 ||
  fail "required command not found: redis-cli"

redis-cli -u "$REDIS_CONN_STRING" --no-auth-warning PING 2>/dev/null |
  grep -qx 'PONG' ||
  fail "Redis readiness check failed"

printf 'Redis traffic-control readiness passed.\n'
