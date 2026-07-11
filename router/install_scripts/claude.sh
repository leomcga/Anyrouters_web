#!/bin/bash
# AnyRouters one-line installer - Claude Code. Safe to run more than once;
# repairs a messed-up shell profile (removes stale/duplicate ANTHROPIC_* lines).
set -e
KEY="${1:-$ANYROUTERS_KEY}"
RESET="${2:---reset}"
MODEL="${ANYROUTERS_MODEL:-claude-sonnet-4-6}"
CONFLICTING_CLAUDE_ENV_NAMES="
ANTHROPIC_API_KEY
CLAUDE_CODE_OAUTH_TOKEN
ANTHROPIC_CUSTOM_HEADERS
ANTHROPIC_SMALL_FAST_MODEL
ANTHROPIC_DEFAULT_OPUS_MODEL
ANTHROPIC_DEFAULT_SONNET_MODEL
ANTHROPIC_DEFAULT_HAIKU_MODEL
ANTHROPIC_DEFAULT_FABLE_MODEL
ANTHROPIC_BEDROCK_BASE_URL
ANTHROPIC_VERTEX_BASE_URL
ANTHROPIC_VERTEX_PROJECT_ID
CLOUD_ML_REGION
CLAUDE_CODE_USE_BEDROCK
CLAUDE_CODE_USE_VERTEX
CLAUDE_CODE_USE_FOUNDRY
CLAUDE_CODE_USE_MANTLE
CLAUDE_CODE_USE_ANTHROPIC_AWS
ANTHROPIC_AWS_WORKSPACE_ID
"
if [ -z "$KEY" ]; then
  echo "X No API key. Run:  curl -fsSL https://anyrouters.com/install/claude.sh | bash -s -- YOUR_KEY"
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
  ""|*YOUR_KEY*|*YOUR_ANYROUTERS_API_KEY*|*本页顶部*|*"API 密钥"*)
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

if [ "$RESET" = "--reset" ] || [ "${ANYROUTERS_RESET:-}" = "1" ]; then
  echo "Resetting AnyRouters Claude Code environment ..."
fi
NPM_PREFIX="${ANYROUTERS_NPM_PREFIX:-$HOME/.anyrouters/npm}"

ensure_node_and_npm() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return 0
  fi
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Node.js via Homebrew ..."
    brew install node
    return 0
  fi
  echo "X Node.js and npm are required. Install Node.js from https://nodejs.org then re-run."
  exit 1
}

install_claude_with_user_npm() {
  ensure_node_and_npm
  mkdir -p "$NPM_PREFIX"
  echo "Installing Claude Code with npm into: $NPM_PREFIX"
  npm install -g --prefix "$NPM_PREFIX" @anthropic-ai/claude-code
  export PATH="$NPM_PREFIX/bin:$PATH"
}

installer_is_html() {
  LC_ALL=C head -c 512 "$1" | grep -Eiq '<!doctype html|<html|</html'
}

update_claude_user_settings() {
  settings_dir="$HOME/.claude"
  settings_path="$settings_dir/settings.json"
  mkdir -p "$settings_dir"

  if command -v node >/dev/null 2>&1; then
    ANYROUTERS_SETTINGS_PATH="$settings_path" ANYROUTERS_MODEL="$MODEL" node <<'NODE'
const fs = require('fs')

const settingsPath = process.env.ANYROUTERS_SETTINGS_PATH
const model = process.env.ANYROUTERS_MODEL
const conflicting = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLOUD_ML_REGION',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'ANTHROPIC_AWS_WORKSPACE_ID',
  'ANTHROPIC_AUTH_TOKEN',
]

let settings = {}
if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '')
  if (raw.trim()) {
    try {
      settings = JSON.parse(raw)
    } catch {
      const invalidBackup = `${settingsPath}.anyrouters-invalid-${Date.now()}.bak`
      fs.copyFileSync(settingsPath, invalidBackup)
      console.log(`Backed up unreadable Claude settings to: ${invalidBackup}`)
      settings = {}
    }
  }
}
if (!settings || Array.isArray(settings) || typeof settings !== 'object') {
  settings = {}
}
if (!settings.env || Array.isArray(settings.env) || typeof settings.env !== 'object') {
  settings.env = {}
}
for (const name of conflicting) {
  delete settings.env[name]
}
delete settings.apiKeyHelper
settings.env.ANTHROPIC_BASE_URL = 'https://api.anyrouters.com'
settings.env.ANTHROPIC_MODEL = model
if (fs.existsSync(settingsPath)) {
  fs.copyFileSync(settingsPath, `${settingsPath}.anyrouters.bak`)
}
fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
console.log(`Updated Claude Code settings: ${settingsPath}`)
NODE
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    ANYROUTERS_SETTINGS_PATH="$settings_path" ANYROUTERS_MODEL="$MODEL" python3 <<'PY'
import json
import os
import shutil
import time

settings_path = os.environ["ANYROUTERS_SETTINGS_PATH"]
model = os.environ["ANYROUTERS_MODEL"]
conflicting = {
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_CUSTOM_HEADERS",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_BEDROCK_BASE_URL",
    "ANTHROPIC_VERTEX_BASE_URL",
    "ANTHROPIC_VERTEX_PROJECT_ID",
    "CLOUD_ML_REGION",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_MANTLE",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS",
    "ANTHROPIC_AWS_WORKSPACE_ID",
    "ANTHROPIC_AUTH_TOKEN",
}

settings = {}
if os.path.exists(settings_path):
    try:
        with open(settings_path, "r", encoding="utf-8-sig") as handle:
            settings = json.load(handle)
    except (json.JSONDecodeError, OSError):
        backup = f"{settings_path}.anyrouters-invalid-{int(time.time())}.bak"
        shutil.copy2(settings_path, backup)
        print(f"Backed up unreadable Claude settings to: {backup}")
        settings = {}
if not isinstance(settings, dict):
    settings = {}
env = settings.get("env")
if not isinstance(env, dict):
    env = {}
settings["env"] = env
for name in conflicting:
    env.pop(name, None)
settings.pop("apiKeyHelper", None)
env["ANTHROPIC_BASE_URL"] = "https://api.anyrouters.com"
env["ANTHROPIC_MODEL"] = model
if os.path.exists(settings_path):
    shutil.copy2(settings_path, f"{settings_path}.anyrouters.bak")
with open(settings_path, "w", encoding="utf-8") as handle:
    json.dump(settings, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
os.chmod(settings_path, 0o600)
print(f"Updated Claude Code settings: {settings_path}")
PY
    return
  fi

  echo "Could not safely update $settings_path because Node.js/Python 3 is unavailable."
}

clear_current_claude_env() {
  for name in $CONFLICTING_CLAUDE_ENV_NAMES; do
    unset "$name"
  done
}

write_claude_env() {
  profile="$1"
  [ -n "$profile" ] || return 0
  touch "$profile"
  cp "$profile" "$profile.anyrouters.bak" 2>/dev/null || true
  tmp_profile="$profile.anyrouters.tmp"
  strip_managed=0
  if grep -qF "# anyrouters-managed-begin" "$profile" &&
    grep -qF "# anyrouters-managed-end" "$profile"; then
    strip_managed=1
  fi
  awk -v strip_managed="$strip_managed" '
    strip_managed && $0 == "# anyrouters-managed-begin" { managed = 1; next }
    strip_managed && managed && $0 == "# anyrouters-managed-end" { managed = 0; next }
    strip_managed && managed { next }
    !strip_managed && ($0 == "# anyrouters-managed-begin" || $0 == "# anyrouters-managed-end") { next }
    $0 ~ /^[[:space:]]*(export[[:space:]]+)?(ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_MODEL|ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_CUSTOM_HEADERS|ANTHROPIC_SMALL_FAST_MODEL|ANTHROPIC_DEFAULT_OPUS_MODEL|ANTHROPIC_DEFAULT_SONNET_MODEL|ANTHROPIC_DEFAULT_HAIKU_MODEL|ANTHROPIC_DEFAULT_FABLE_MODEL|ANTHROPIC_BEDROCK_BASE_URL|ANTHROPIC_VERTEX_BASE_URL|ANTHROPIC_VERTEX_PROJECT_ID|CLOUD_ML_REGION|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|CLAUDE_CODE_USE_MANTLE|CLAUDE_CODE_USE_ANTHROPIC_AWS|ANTHROPIC_AWS_WORKSPACE_ID)[[:space:]]*=/ { next }
    { print }
  ' "$profile" > "$tmp_profile"
  mv "$tmp_profile" "$profile"
  {
    printf '\n# anyrouters-managed-begin\n'
    echo "export PATH=\"$NPM_PREFIX/bin:\$PATH\""
    for name in $CONFLICTING_CLAUDE_ENV_NAMES; do
      printf 'unset %s\n' "$name"
    done
    echo "export ANTHROPIC_BASE_URL=https://api.anyrouters.com"
    printf 'export ANTHROPIC_AUTH_TOKEN=%s\n' "$(printf '%s' "$KEY" | sed "s/'/'\\\\''/g; s/.*/'&'/")"
    printf 'export ANTHROPIC_MODEL=%s\n' "$(printf '%s' "$MODEL" | sed "s/'/'\\\\''/g; s/.*/'&'/")"
    printf '# anyrouters-managed-end\n'
  } >> "$profile"
  echo "Saved AnyRouters Claude environment to: $profile"
}

echo "Installing Claude Code ..."
tmp_installer="$(mktemp)"
official_installed=0
if curl -fsSL https://claude.ai/install.sh -o "$tmp_installer"; then
  if installer_is_html "$tmp_installer"; then
    echo "Official installer returned an HTML page. Skipping it."
  elif bash "$tmp_installer"; then
    official_installed=1
  else
    echo "Official installer failed."
  fi
else
  echo "Official installer download failed."
fi
rm -f "$tmp_installer"
if [ "$official_installed" -ne 1 ]; then
  echo "Using npm fallback without administrator permissions ..."
  install_claude_with_user_npm
fi

update_claude_user_settings
clear_current_claude_env
export ANTHROPIC_BASE_URL="https://api.anyrouters.com"
export ANTHROPIC_AUTH_TOKEN="$KEY"
export ANTHROPIC_MODEL="$MODEL"
case "${SHELL:-}" in
  */zsh)
    write_claude_env "${ZDOTDIR:-$HOME}/.zshrc"
    write_claude_env "${ZDOTDIR:-$HOME}/.zprofile"
    ;;
  */bash)
    write_claude_env "$HOME/.bashrc"
    write_claude_env "$HOME/.bash_profile"
    ;;
  *)
    write_claude_env "$HOME/.profile"
    ;;
esac
if command -v launchctl >/dev/null 2>&1; then
  for name in $CONFLICTING_CLAUDE_ENV_NAMES; do
    launchctl unsetenv "$name" 2>/dev/null || true
  done
  launchctl setenv ANTHROPIC_BASE_URL "https://api.anyrouters.com" 2>/dev/null || true
  launchctl setenv ANTHROPIC_AUTH_TOKEN "$KEY" 2>/dev/null || true
  launchctl setenv ANTHROPIC_MODEL "$MODEL" 2>/dev/null || true
fi
echo "Cleared old Claude provider settings that could override AnyRouters."
echo ""
if command -v claude >/dev/null 2>&1; then
  claude --version || true
else
  echo "Claude Code is installed, but the claude command is not on this terminal's PATH yet."
fi
echo "OK Done! Open a NEW terminal window and run:  claude"
