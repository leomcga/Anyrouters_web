#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

app_env="$(printf '%s' "${APP_ENV:-}" | tr '[:upper:]' '[:lower:]')"
[[ "$app_env" == "production" || "$app_env" == "prod" ]] ||
  fail "APP_ENV must be production"

for name in \
  SQL_DSN \
  REDIS_CONN_STRING \
  SESSION_SECRET \
  API_KEY_PEPPER \
  STRIPE_SECRET_KEY \
  STRIPE_WEBHOOK_SECRET \
  STRIPE_SUCCESS_URL \
  STRIPE_CANCEL_URL; do
  [[ -n "${!name:-}" ]] || fail "required environment variable is missing: $name"
done

[[ "${#SESSION_SECRET}" -ge 32 ]] ||
  fail "SESSION_SECRET must contain at least 32 characters"
[[ "${#API_KEY_PEPPER}" -ge 32 ]] ||
  fail "API_KEY_PEPPER must contain at least 32 characters"
[[ "${STRIPE_MODE:-}" == "live" ]] ||
  fail "STRIPE_MODE must be live"
[[ "$STRIPE_SECRET_KEY" == sk_live_* ]] ||
  fail "STRIPE_SECRET_KEY must be a live key"
[[ "$STRIPE_WEBHOOK_SECRET" == whsec_* ]] ||
  fail "STRIPE_WEBHOOK_SECRET has an invalid type"
[[ "$STRIPE_SUCCESS_URL" == https://* && "$STRIPE_CANCEL_URL" == https://* ]] ||
  fail "Stripe success and cancel URLs must use HTTPS"

for name in \
  TRAFFIC_USER_RPM TRAFFIC_KEY_RPM TRAFFIC_IP_RPM \
  TRAFFIC_USER_TPM TRAFFIC_KEY_TPM TRAFFIC_IP_TPM \
  TRAFFIC_USER_MAX_CONCURRENT TRAFFIC_KEY_MAX_CONCURRENT \
  TRAFFIC_USER_DAILY_TOKENS TRAFFIC_KEY_DAILY_TOKENS \
  TRAFFIC_USER_DAILY_QUOTA CHANNEL_CIRCUIT_FAILURE_THRESHOLD \
  CHANNEL_CIRCUIT_OPEN_SECONDS CHANNEL_CIRCUIT_HALF_OPEN_PROBES; do
  value="${!name:-}"
  [[ "$value" =~ ^[1-9][0-9]*$ ]] ||
    fail "$name must be a positive integer"
done

printf 'Production configuration passed fail-closed checks.\n'
