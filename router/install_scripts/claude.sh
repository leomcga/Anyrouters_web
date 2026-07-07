#!/bin/bash
# AnyRouters one-line installer - Claude Code. Safe to run more than once;
# repairs a messed-up shell profile (removes stale/duplicate ANTHROPIC_* lines).
set -e
KEY="${1:-$ANYROUTERS_KEY}"
RESET="${2:---reset}"
MODEL="${ANYROUTERS_MODEL:-claude-sonnet-4-6}"
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
case "${SHELL:-}" in
  */zsh) PROFILE="$HOME/.zshrc" ;;
  */bash) PROFILE="$HOME/.bash_profile" ;;
  *) PROFILE="$HOME/.profile" ;;
esac
[ -f "$PROFILE" ] || touch "$PROFILE"
cp "$PROFILE" "$PROFILE.anyrouters.bak" 2>/dev/null || true
BEGIN_MARK="# anyrouters-managed-begin"
END_MARK="# anyrouters-managed-end"
if grep -qF "$BEGIN_MARK" "$PROFILE"; then
  sed -i.anyrtmp "/$BEGIN_MARK/,/$END_MARK/d" "$PROFILE"; rm -f "$PROFILE.anyrtmp"
fi
for v in ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL; do
  sed -i.anyrtmp "s|^\([[:space:]]*export ${v}=\)|# disabled-by-anyrouters \1|" "$PROFILE"; rm -f "$PROFILE.anyrtmp"
done
{
  printf '\n%s\n' "$BEGIN_MARK"
  echo "export PATH=\"$NPM_PREFIX/bin:\$PATH\""
  echo "export ANTHROPIC_BASE_URL=https://api.anyrouters.com"
  echo "export ANTHROPIC_AUTH_TOKEN=$KEY"
  echo "export ANTHROPIC_MODEL=$MODEL"
  echo "$END_MARK"
} >> "$PROFILE"
echo ""
if command -v claude >/dev/null 2>&1; then
  claude --version || true
else
  echo "Claude Code is installed, but the claude command is not on this terminal's PATH yet."
fi
echo "OK Done! Open a NEW terminal window and run:  claude"
