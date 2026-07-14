#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

app_env="$(printf '%s' "${APP_ENV:-}" | tr '[:upper:]' '[:lower:]')"
[[ "$app_env" == "production" || "$app_env" == "prod" ]] ||
  fail "APP_ENV must be production for outbound security readiness"

[[ "$(printf '%s' "${OUTBOUND_ALLOW_HTTP:-false}" | tr '[:upper:]' '[:lower:]')" == "false" ]] ||
  fail "OUTBOUND_ALLOW_HTTP must be false in production"

[[ "$(printf '%s' "${TLS_INSECURE_SKIP_VERIFY:-false}" | tr '[:upper:]' '[:lower:]')" == "false" ]] ||
  fail "TLS_INSECURE_SKIP_VERIFY must be false in production"

for variable in \
  OUTBOUND_MAX_REDIRECTS \
  OUTBOUND_MAX_REQUEST_BYTES \
  OUTBOUND_MAX_RESPONSE_BYTES \
  OUTBOUND_CONNECT_TIMEOUT_SECONDS \
  OUTBOUND_TLS_HANDSHAKE_TIMEOUT_SECONDS \
  OUTBOUND_RESPONSE_HEADER_TIMEOUT_SECONDS \
  OUTBOUND_REQUEST_TIMEOUT_SECONDS
do
  value="${!variable:-}"
  [[ "$value" =~ ^[1-9][0-9]*$ ]] ||
    fail "$variable must be configured as a positive integer"
done

for inherited_proxy in HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy; do
  [[ -z "${!inherited_proxy:-}" ]] ||
    fail "$inherited_proxy must be unset; use OUTBOUND_TRUSTED_PROXY_URLS with an explicit channel proxy"
done

if [[ -n "${OUTBOUND_TRUSTED_PROXY_URLS:-}" ]]; then
  IFS=',' read -r -a proxy_urls <<< "$OUTBOUND_TRUSTED_PROXY_URLS"
  for proxy_url in "${proxy_urls[@]}"; do
    trimmed="$(printf '%s' "$proxy_url" | xargs)"
    [[ "$trimmed" =~ ^(https?|socks5h?)://[^/@[:space:]]+(:[0-9]+)?$ ]] ||
      fail "OUTBOUND_TRUSTED_PROXY_URLS contains an invalid or credential-bearing URL"
  done
fi

printf 'Outbound security readiness passed.\n'
