#!/bin/bash
# AnyRouters one-line config writer - Codex desktop/app. Safe to run more than once.
set -eu
KEY="${1:-${ANYROUTERS_KEY:-}}"
MODEL="${ANYROUTERS_MODEL:-gpt-5.6-sol}"
CODEX_DIR="$HOME/.codex"
CATALOG="$CODEX_DIR/model-catalog-anyrouters-gpt56.json"
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

resolve_codex_binary() {
  if [ -n "${ANYROUTERS_CODEX_BIN:-}" ] && [ -x "$ANYROUTERS_CODEX_BIN" ]; then
    printf '%s\n' "$ANYROUTERS_CODEX_BIN"
    return 0
  fi
  for candidate in \
    "/Applications/ChatGPT.app/Contents/Resources/codex" \
    "$HOME/Applications/ChatGPT.app/Contents/Resources/codex"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  if command -v codex >/dev/null 2>&1; then
    command -v codex
    return 0
  fi
  return 1
}

CODEX_BIN="$(resolve_codex_binary || true)"
if [ -z "$CODEX_BIN" ]; then
  echo "X Could not find Codex. Install the desktop app (or Codex CLI), then re-run this command."
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "X Python 3 is required to build the current Codex model catalog safely."
  exit 1
fi

mkdir -p "$CODEX_DIR"
chmod 700 "$CODEX_DIR" 2>/dev/null || true
work_dir="$(mktemp -d "$CODEX_DIR/.anyrouters-gpt56.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
mkdir -p "$work_dir/codex-home"

echo "Reading the current complete Codex model catalog ..."
if ! CODEX_HOME="$work_dir/codex-home" "$CODEX_BIN" debug models > "$work_dir/catalog.raw.json"; then
  echo "X Codex could not export its current model catalog. Existing configuration was not changed."
  exit 1
fi

python3 - \
  "$work_dir/catalog.raw.json" \
  "$work_dir/model-catalog.json" \
  "$work_dir/config.toml" \
  "$CATALOG" "$MODEL" \
  "$CODEX_DIR/config.toml" <<'PY'
import json
import os
import re
import sys

src, catalog_stage, config_stage, catalog, model, current_config_path = sys.argv[1:]
with open(src, encoding="utf-8") as handle:
    data = json.load(handle)

models = data.get("models")
if not isinstance(models, list):
    raise SystemExit("X Codex returned an invalid model catalog; existing configuration was not changed.")

wanted = {"gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"}
patched = set()
for entry in models:
    if not isinstance(entry, dict):
        continue
    slug = entry.get("slug")
    if slug in wanted:
        entry["use_responses_lite"] = False
        entry["multi_agent_version"] = None
        entry["tool_mode"] = None
        patched.add(slug)

missing = sorted(wanted - patched)
if missing:
    raise SystemExit(
        "X Current Codex model catalog is missing: "
        + ", ".join(missing)
        + ". Existing configuration was not changed."
    )

catalog = os.path.abspath(catalog)
with open(catalog_stage, "w", encoding="utf-8") as handle:
    json.dump(data, handle, ensure_ascii=False, indent=2)
    handle.write("\n")

managed_config = f'''model = {json.dumps(model)}
model_provider = "anyrouters"
model_reasoning_effort = "medium"
disable_response_storage = true
model_catalog_json = {json.dumps(catalog)}
'''
anyrouters_provider = '''[model_providers.anyrouters]
name = "AnyRouters"
base_url = "https://api.anyrouters.com/v1"
wire_api = "responses"
env_key = "OPENAI_API_KEY"
'''


def preserve_unmanaged_config(path):
    if not os.path.isfile(path):
        return ""
    try:
        with open(path, encoding="utf-8") as handle:
            current = handle.read()
        import tomllib

        tomllib.loads(current)
    except Exception as exc:
        raise SystemExit(
            "X Existing Codex config.toml is invalid; existing configuration was not changed."
        ) from exc

    managed_root_keys = {
        "model",
        "model_provider",
        "model_reasoning_effort",
        "disable_response_storage",
        "model_catalog_json",
    }
    kept = []
    at_root = True
    skip_anyrouters_provider = False
    header_pattern = re.compile(r"^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$")
    for line in current.splitlines(keepends=True):
        stripped = line.strip()
        header = header_pattern.match(stripped)
        if header:
            section = header.group(1).strip()
            skip_anyrouters_provider = section == "model_providers.anyrouters" or section.startswith(
                "model_providers.anyrouters."
            )
            at_root = False
            if skip_anyrouters_provider:
                continue
        elif skip_anyrouters_provider:
            continue
        if at_root:
            assignment = re.match(r"^([A-Za-z0-9_-]+)\s*=", stripped)
            if assignment and assignment.group(1) in managed_root_keys:
                continue
        kept.append(line)
    return "".join(kept).strip()


preserved_config = preserve_unmanaged_config(current_config_path)
config_parts = [managed_config.strip()]
if preserved_config:
    config_parts.append(preserved_config)
config_parts.append(anyrouters_provider.strip())
config = "\n\n".join(config_parts) + "\n"

with open(config_stage, "w", encoding="utf-8") as handle:
    handle.write(config)

print("Patched GPT-5.6 compatibility metadata: " + ", ".join(sorted(patched)))
print("Preserved existing Codex MCP, feature, project, plugin, and login configuration.")
PY

stamp="$(date +%Y%m%d-%H%M%S)-$$"
backup_dir="$CODEX_DIR/anyrouters-backup-$stamp"
mkdir -p "$backup_dir"
for file in config.toml auth.json model-catalog-anyrouters-gpt56.json; do
  if [ -f "$CODEX_DIR/$file" ]; then
    cp -p "$CODEX_DIR/$file" "$backup_dir/$file"
  fi
done
echo "Backed up old Codex files to: $backup_dir"
echo "Restore files from this directory if you need to roll back."

mv "$work_dir/model-catalog.json" "$CATALOG"
mv "$work_dir/config.toml" "$CODEX_DIR/config.toml"
chmod 600 "$CODEX_DIR/config.toml" "$CATALOG" 2>/dev/null || true

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
echo "OK Done! Command-Q to fully quit Codex desktop, reopen it, and start a NEW task."
echo "GPT-5.6 compatibility mode disables native collaboration/subagents for Sol, Terra, and Luna."
echo "Normal chat, shell commands, and file tools remain available. Re-run after every Codex upgrade."
