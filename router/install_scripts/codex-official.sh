#!/bin/bash
# Restore Codex CLI/Desktop to the built-in OpenAI provider without reinstalling Codex.
set -eu

CODEX_DIR="$HOME/.codex"
CONFIG="$CODEX_DIR/config.toml"
work_dir=""

fail() {
  printf 'X %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [ -n "${work_dir:-}" ] && [ -d "$work_dir" ]; then
    rm -rf "$work_dir"
  fi
}
trap cleanup EXIT HUP INT TERM

command -v python3 >/dev/null 2>&1 || fail "Python 3 is required to restore the Codex configuration safely."

resolve_codex_binary() {
  if [ -n "${ANYROUTERS_CODEX_BIN:-}" ] && [ -x "$ANYROUTERS_CODEX_BIN" ]; then
    printf '%s\n' "$ANYROUTERS_CODEX_BIN"
    return 0
  fi
  if [ -n "${ALLROUTERS_CODEX_BIN:-}" ] && [ -x "$ALLROUTERS_CODEX_BIN" ]; then
    printf '%s\n' "$ALLROUTERS_CODEX_BIN"
    return 0
  fi
  if command -v codex >/dev/null 2>&1; then
    command -v codex
    return 0
  fi
  for candidate in \
    "$HOME/.local/bin/codex" \
    "/Applications/ChatGPT.app/Contents/Resources/codex"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

remove_managed_profile_block() {
  profile="$1"
  [ -f "$profile" ] || return 0
  python3 - "$profile" <<'PY'
import os
import re
import shutil
import stat
import sys
import tempfile

profile = os.path.abspath(os.path.expanduser(sys.argv[1]))
blocks = {
    "# anyrouters-codex-managed-begin": "# anyrouters-codex-managed-end",
    "# allrouters-codex-managed-begin": "# allrouters-codex-managed-end",
}
names = (
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
    "OPENAI_API_HOST",
    "OPENAI_ORG_ID",
    "OPENAI_ORGANIZATION",
    "OPENAI_PROJECT",
    "CODEX_API_KEY",
)
name_pattern = "|".join(map(re.escape, names))
assignment = re.compile(
    r"^\s*(?:(?:export\s+)?(?:"
    + name_pattern
    + r")\s*=|set\s+(?:-[A-Za-z]+\s+|--[A-Za-z-]+\s+)*(?:"
    + name_pattern
    + r")(?:\s|$))"
)

with open(profile, encoding="utf-8") as handle:
    original = handle.read()

kept = []
expected_end = None
found = False
for line in original.splitlines(keepends=True):
    logical = line.rstrip("\r\n")
    if logical in blocks:
        expected_end = blocks[logical]
        found = True
        continue
    if expected_end and logical == expected_end:
        expected_end = None
        continue
    if expected_end is None and not assignment.match(logical):
        kept.append(line)
    elif expected_end is None:
        found = True

if not found:
    raise SystemExit(0)

updated = "".join(kept).rstrip("\r\n")
if updated:
    updated += "\n"

backup = profile + ".router-official.bak"
if not os.path.exists(backup):
    shutil.copy2(profile, backup)
parent = os.path.dirname(profile)
mode = stat.S_IMODE(os.stat(profile).st_mode)
fd, staged = tempfile.mkstemp(prefix=os.path.basename(profile) + ".official.", dir=parent)
try:
    os.fchmod(fd, mode)
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
        handle.write(updated)
    os.replace(staged, profile)
except BaseException:
    try:
        os.unlink(staged)
    except FileNotFoundError:
        pass
    raise
PY
}

restore_official_environment() {
  for profile in \
    "${ZDOTDIR:-$HOME}/.zshrc" \
    "${ZDOTDIR:-$HOME}/.zprofile" \
    "$HOME/.bashrc" \
    "$HOME/.bash_profile" \
    "$HOME/.bash_login" \
    "$HOME/.profile" \
    "$HOME/.config/fish/config.fish"; do
    remove_managed_profile_block "$profile"
  done
  if command -v launchctl >/dev/null 2>&1; then
    for name in \
      OPENAI_API_KEY \
      OPENAI_BASE_URL \
      OPENAI_API_BASE \
      OPENAI_API_HOST \
      OPENAI_ORG_ID \
      OPENAI_ORGANIZATION \
      OPENAI_PROJECT \
      CODEX_API_KEY; do
      launchctl unsetenv "$name" 2>/dev/null || true
    done
  fi
  unset \
    OPENAI_API_KEY \
    OPENAI_BASE_URL \
    OPENAI_API_BASE \
    OPENAI_API_HOST \
    OPENAI_ORG_ID \
    OPENAI_ORGANIZATION \
    OPENAI_PROJECT \
    CODEX_API_KEY 2>/dev/null || true
}

mkdir -p "$CODEX_DIR"
chmod 700 "$CODEX_DIR" 2>/dev/null || true
work_dir="$(mktemp -d "$CODEX_DIR/.codex-official.XXXXXX")"
mkdir -p "$work_dir/validate-home"

if [ -f "$CONFIG" ]; then
  python3 - "$CONFIG" "$work_dir/config.toml" <<'PY'
import re
import sys

current_path, staged_path = sys.argv[1:]
with open(current_path, encoding="utf-8") as handle:
    current = handle.read()

kept = []
at_root = True
skip_provider = False
header_pattern = re.compile(r"^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$")
official_reset_keys = {
    "model",
    "model_provider",
    "model_catalog_json",
    "profile",
    "openai_base_url",
    "chatgpt_base_url",
    "experimental_realtime_ws_base_url",
}

for line in current.splitlines(keepends=True):
    stripped = line.strip()
    header = header_pattern.match(stripped)
    if header:
        section = header.group(1).strip()
        skip_provider = (
            section in {"model_providers.anyrouters", "model_providers.allrouters"}
            or section.startswith("model_providers.anyrouters.")
            or section.startswith("model_providers.allrouters.")
        )
        at_root = False
        if skip_provider:
            continue
    elif skip_provider:
        continue
    if at_root:
        assignment = re.match(r"^([A-Za-z0-9_-]+)\s*=", stripped)
        if assignment and assignment.group(1) in official_reset_keys:
            continue
    kept.append(line)

updated = "".join(kept).strip()
with open(staged_path, "w", encoding="utf-8") as handle:
    if updated:
        handle.write(updated + "\n")
PY

  CODEX_BIN="$(resolve_codex_binary || true)"
  [ -n "$CODEX_BIN" ] || fail "Could not find Codex. Existing configuration was not changed."
  cp "$work_dir/config.toml" "$work_dir/validate-home/config.toml"
  if ! env \
    -u OPENAI_API_KEY \
    -u OPENAI_BASE_URL \
    -u OPENAI_API_BASE \
    -u OPENAI_API_HOST \
    -u OPENAI_ORG_ID \
    -u OPENAI_ORGANIZATION \
    -u OPENAI_PROJECT \
    -u CODEX_API_KEY \
    CODEX_HOME="$work_dir/validate-home" \
    CODEX_NON_INTERACTIVE=1 \
    "$CODEX_BIN" debug models >/dev/null; then
    fail "The restored official config did not validate; existing configuration was not changed."
  fi

  stamp="$(date +%Y%m%d-%H%M%S)-$$"
  backup_dir="$CODEX_DIR/codex-official-backup-$stamp"
  mkdir -p "$backup_dir"
  cp -p "$CONFIG" "$backup_dir/config.toml"
  mv "$work_dir/config.toml" "$CONFIG"
  chmod 600 "$CONFIG"
  echo "Backed up the previous config to: $backup_dir"
fi

restore_official_environment

echo ""
echo "OK Active third-party/OpenAI API routing overrides were removed; Codex now uses the built-in OpenAI provider."
echo "Unselected third-party provider definitions were preserved and are no longer active."
echo "Codex was not uninstalled, and auth.json, MCP, plugins, tools, and chat history were preserved."
echo "Open a NEW terminal and run: codex login status"
echo "If it does not show ChatGPT sign-in, run: codex logout"
echo "Then run: codex login"
