#!/bin/bash
# AnyRouters one-line config writer - Codex desktop/app. Safe to run more than once.
set -e
KEY="${1:-$ANYROUTERS_KEY}"
RESET="${2:-}"
if [ -z "$KEY" ]; then
  echo "X No API key. Run:  curl -fsSL https://anyrouters.com/install/codex-config.sh | bash -s -- YOUR_KEY"
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

[model_providers.anyrouters]
name = "AnyRouters"
base_url = "https://api.anyrouters.com/v1"
wire_api = "responses"
TOML

printf '{\n  "OPENAI_API_KEY": "%s"\n}\n' "$KEY" > "$HOME/.codex/auth.json"
chmod 600 "$HOME/.codex/config.toml" "$HOME/.codex/auth.json" 2>/dev/null || true

echo ""
echo "OK Done! Fully quit and reopen Codex desktop, then send a message."
