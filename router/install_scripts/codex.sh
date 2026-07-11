#!/bin/bash
# AnyRouters one-line installer - Codex CLI. Safe to run more than once.
set -e
KEY="${1:-$ANYROUTERS_KEY}"
RESET="${2:---reset}"
MODEL="${ANYROUTERS_MODEL:-gpt-5.6-sol}"
CONFLICTING_CODEX_ENV_NAMES="
OPENAI_BASE_URL
OPENAI_API_BASE
OPENAI_API_HOST
OPENAI_ORG_ID
OPENAI_ORGANIZATION
OPENAI_PROJECT
CODEX_API_KEY
"
if [ -z "$KEY" ]; then
  echo "X No API key. Run:  curl -fsSL https://anyrouters.com/install/codex.sh | bash -s -- YOUR_KEY"
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

echo "Installing Codex CLI ..."
tmp_installer="$(mktemp)"
if curl -fsSL https://chatgpt.com/codex/install.sh -o "$tmp_installer" && CODEX_NON_INTERACTIVE=1 sh "$tmp_installer"; then
  rm -f "$tmp_installer"
else
  rm -f "$tmp_installer"
  echo "Official installer failed. Trying npm ..."
  if ! command -v node >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      echo "Installing Node.js via Homebrew ..."
      brew install node
    else
      echo "X Node.js is required. Install it from https://nodejs.org then re-run."
      exit 1
    fi
  fi
  npm install -g @openai/codex
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
cat > "$HOME/.codex/config.toml" <<TOML
model = "$MODEL"
model_provider = "anyrouters"
model_reasoning_effort = "medium"
disable_response_storage = true

[model_providers.anyrouters]
name = "AnyRouters"
base_url = "https://api.anyrouters.com/v1"
wire_api = "responses"
env_key = "OPENAI_API_KEY"
TOML
printf '{\n  "OPENAI_API_KEY": "%s"\n}\n' "$KEY" > "$HOME/.codex/auth.json"
chmod 600 "$HOME/.codex/config.toml" "$HOME/.codex/auth.json" 2>/dev/null || true

clear_current_codex_env() {
  for name in $CONFLICTING_CODEX_ENV_NAMES; do
    unset "$name"
  done
}

write_codex_env() {
  profile="$1"
  [ -n "$profile" ] || return 0
  touch "$profile"
  cp "$profile" "$profile.anyrouters.bak" 2>/dev/null || true
  tmp_profile="$profile.anyrouters.tmp"
  strip_managed=0
  if grep -qF "# anyrouters-codex-managed-begin" "$profile" &&
    grep -qF "# anyrouters-codex-managed-end" "$profile"; then
    strip_managed=1
  fi
  awk -v strip_managed="$strip_managed" '
    strip_managed && $0 == "# anyrouters-codex-managed-begin" { managed = 1; next }
    strip_managed && managed && $0 == "# anyrouters-codex-managed-end" { managed = 0; next }
    strip_managed && managed { next }
    !strip_managed && ($0 == "# anyrouters-codex-managed-begin" || $0 == "# anyrouters-codex-managed-end") { next }
    $0 ~ /^[[:space:]]*(export[[:space:]]+)?(OPENAI_API_KEY|OPENAI_BASE_URL|OPENAI_API_BASE|OPENAI_API_HOST|OPENAI_ORG_ID|OPENAI_ORGANIZATION|OPENAI_PROJECT|CODEX_API_KEY)[[:space:]]*=/ { next }
    { print }
  ' "$profile" > "$tmp_profile"
  mv "$tmp_profile" "$profile"
  {
    printf '\n# anyrouters-codex-managed-begin\n'
    for name in $CONFLICTING_CODEX_ENV_NAMES; do
      printf 'unset %s\n' "$name"
    done
    printf 'export OPENAI_API_KEY=%s\n' "$(printf '%s' "$KEY" | sed "s/'/'\\\\''/g; s/.*/'&'/")"
    printf '# anyrouters-codex-managed-end\n'
  } >> "$profile"
  echo "Saved AnyRouters Codex environment to: $profile"
}

clear_current_codex_env
export OPENAI_API_KEY="$KEY"
case "${SHELL:-}" in
  */zsh)
    write_codex_env "${ZDOTDIR:-$HOME}/.zshrc"
    write_codex_env "${ZDOTDIR:-$HOME}/.zprofile"
    ;;
  */bash)
    write_codex_env "$HOME/.bashrc"
    write_codex_env "$HOME/.bash_profile"
    ;;
  *)
    write_codex_env "$HOME/.profile"
    ;;
esac
if command -v launchctl >/dev/null 2>&1; then
  for name in $CONFLICTING_CODEX_ENV_NAMES; do
    launchctl unsetenv "$name" 2>/dev/null || true
  done
  launchctl setenv OPENAI_API_KEY "$KEY" 2>/dev/null || true
fi
echo "Cleared old Codex/OpenAI-compatible settings that could override AnyRouters."
echo ""
echo "OK Done! Open a NEW terminal window and run:  codex"
