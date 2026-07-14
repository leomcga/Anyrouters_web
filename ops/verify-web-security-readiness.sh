#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

app_env="$(printf '%s' "${APP_ENV:-}" | tr '[:upper:]' '[:lower:]')"
[[ "$app_env" == "production" || "$app_env" == "prod" ]] ||
  fail "APP_ENV must be production for web security readiness"

session_secret="${SESSION_SECRET:-}"
[[ "${#session_secret}" -ge 32 ]] ||
  fail "SESSION_SECRET must contain at least 32 characters"

[[ "${DEBUG:-false}" != "true" ]] ||
  fail "DEBUG must be false in production"
[[ "${DIFY_DEBUG:-false}" != "true" ]] ||
  fail "DIFY_DEBUG must be false in production"
[[ "${ENABLE_PPROF:-false}" != "true" ]] ||
  fail "ENABLE_PPROF must be false in production"

[[ "${CORS_ALLOWED_ORIGINS:-}" != *"*"* ]] ||
  fail "CORS_ALLOWED_ORIGINS must not contain a wildcard"

if [[ -n "${CORS_ALLOWED_ORIGINS:-}" ]]; then
  IFS=',' read -r -a origins <<<"$CORS_ALLOWED_ORIGINS"
  for origin in "${origins[@]}"; do
    [[ "$origin" =~ ^https://[^/]+/?$ ]] ||
      fail "each CORS_ALLOWED_ORIGINS entry must be an exact HTTPS origin"
  done
fi

if [[ -n "${FRONTEND_BASE_URL:-}" ]]; then
  [[ "$FRONTEND_BASE_URL" =~ ^https://[^/]+/?$ ]] ||
    fail "FRONTEND_BASE_URL must be an exact HTTPS origin"
fi

printf 'Web security readiness passed.\n'
