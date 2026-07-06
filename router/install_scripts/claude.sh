#!/bin/bash
# AnyRouters one-line installer - Claude Code. Safe to run more than once;
# repairs a messed-up shell profile (removes stale/duplicate ANTHROPIC_* lines).
set -e
KEY="${1:-$ANYROUTERS_KEY}"
RESET="${2:-}"
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
if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Node.js via Homebrew ..."
    brew install node
  else
    echo "X Node.js is required. Install it from https://nodejs.org then re-run."
    exit 1
  fi
fi
echo "Installing @anthropic-ai/claude-code ..."
npm install -g @anthropic-ai/claude-code
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
  echo "export ANTHROPIC_BASE_URL=https://api.anyrouters.com"
  echo "export ANTHROPIC_AUTH_TOKEN=$KEY"
  echo "export ANTHROPIC_MODEL=$MODEL"
  echo "$END_MARK"
} >> "$PROFILE"
echo ""
echo "OK Done! Open a NEW terminal window, then:  cd your-project && claude"
