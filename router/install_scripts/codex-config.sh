#!/bin/bash
# AnyRouters one-line config writer - Codex desktop/app. Safe to run more than once.
set -e
KEY="${1:-$ANYROUTERS_KEY}"
RESET="${2:-}"
if [ -z "$KEY" ]; then
  echo "X No API key. Run:  curl -fsSL https://anyrouters.com/install/codex-config.sh | bash -s -- YOUR_KEY"
  exit 1
fi

normalize_key() {
  k="$(printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  k="${k#Bearer }"
  k="${k#bearer }"
  k="${k%\"}"
  k="${k#\"}"
  k="${k%\'}"
  k="${k#\'}"
  case "$k" in
    sk-anyrouters-sk-*) k="sk-${k#sk-anyrouters-sk-}" ;;
    sk-anyrouters-*) k="sk-${k#sk-anyrouters-}" ;;
    anyrouters-sk-*) k="sk-${k#anyrouters-sk-}" ;;
  esac
  printf '%s' "$k"
}

ORIGINAL_KEY="$KEY"
KEY="$(normalize_key "$KEY")"
if [ "$ORIGINAL_KEY" != "$KEY" ]; then
  echo "Fixed API key prefix: removed accidental sk-anyrouters-."
fi
case "$KEY" in
  ""|*YOUR_KEY*|*YOUR_ANYROUTERS_API_KEY*)
    echo "X Replace the placeholder with your real AnyRouters API key."
    exit 1
    ;;
esac

status="$(curl -sS -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $KEY" https://api.anyrouters.com/v1/models || true)"
if [ "$status" != "200" ]; then
  echo "X API key validation failed (HTTP $status)."
  echo "  Copy the complete key from AnyRouters API Keys. Do not add sk-anyrouters- before it."
  exit 1
fi

mkdir -p "$HOME/.codex"
chmod 700 "$HOME/.codex" 2>/dev/null || true

if [ "$RESET" = "--reset" ] || [ "${ANYROUTERS_RESET:-}" = "1" ]; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup_dir="$HOME/.codex/anyrouters-reset-$stamp"
  mkdir -p "$backup_dir"
  for f in config.toml auth.json; do
    if [ -f "$HOME/.codex/$f" ]; then
      mv "$HOME/.codex/$f" "$backup_dir/$f"
    fi
  done
  echo "Backed up old Codex config to: $backup_dir"
else
  [ -f "$HOME/.codex/config.toml" ] && cp "$HOME/.codex/config.toml" "$HOME/.codex/config.toml.anyrouters.bak"
  [ -f "$HOME/.codex/auth.json" ] && cp "$HOME/.codex/auth.json" "$HOME/.codex/auth.json.anyrouters.bak"
fi

cat > "$HOME/.codex/config.toml" <<'TOML'
model = "gpt-5.5"
model_provider = "anyrouters"
model_reasoning_effort = "medium"
disable_response_storage = true
cli_auth_credentials_store = "file"

[model_providers.anyrouters]
name = "AnyRouters"
base_url = "https://api.anyrouters.com/v1"
wire_api = "responses"
requires_openai_auth = true
TOML

printf '{\n  "OPENAI_API_KEY": "%s"\n}\n' "$KEY" > "$HOME/.codex/auth.json"
chmod 600 "$HOME/.codex/config.toml" "$HOME/.codex/auth.json" 2>/dev/null || true

echo ""
echo "OK Done! Fully quit and reopen Codex desktop, then send a message."
