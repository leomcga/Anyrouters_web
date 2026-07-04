#!/bin/bash
# AnyRouters one-line installer - Codex CLI. Safe to run more than once.
set -e
KEY="${1:-$ANYROUTERS_KEY}"
if [ -z "$KEY" ]; then
  echo "X No API key. Run:  curl -fsSL https://anyrouters.com/install/codex.sh | bash -s -- YOUR_KEY"
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Node.js via Homebrew ..."
    brew install node
  else
    echo "X Node.js is required. Install it from https://nodejs.org then re-run."
    exit 1
  fi
fi
echo "Installing @openai/codex ..."
npm install -g @openai/codex
mkdir -p "$HOME/.codex"
[ -f "$HOME/.codex/config.toml" ] && cp "$HOME/.codex/config.toml" "$HOME/.codex/config.toml.anyrouters.bak"
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
[ -f "$HOME/.codex/auth.json" ] && cp "$HOME/.codex/auth.json" "$HOME/.codex/auth.json.anyrouters.bak"
printf '{\n  "OPENAI_API_KEY": "%s"\n}\n' "$KEY" > "$HOME/.codex/auth.json"
echo ""
echo "OK Done! Open a NEW terminal window and run:  codex"
