#!/usr/bin/env bash

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-anyrouters-prod}"
REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-newapi}"
SQL_INSTANCE="${SQL_INSTANCE:-anyrouters-mysql}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-36}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

is_true() {
  [[ "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" == "true" ]]
}

for command in gcloud git python3; do
  command -v "$command" >/dev/null 2>&1 || fail "required command not found: $command"
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

active_project="$(gcloud config get-value project 2>/dev/null)"
[[ "$active_project" == "$PROJECT_ID" ]] ||
  fail "active gcloud project is '$active_project', expected '$PROJECT_ID'"

if [[ "${SKIP_GIT_CHECK:-0}" != "1" ]]; then
  [[ -z "$(git status --porcelain)" ]] ||
    fail "git working tree is not clean"
  git fetch origin --quiet
  read -r behind ahead < <(git rev-list --left-right --count HEAD...origin/main)
  [[ "$behind" == "0" && "$ahead" == "0" ]] ||
    fail "HEAD is not synchronized with origin/main (behind=$behind ahead=$ahead)"
fi

read -r sql_state deletion_protection backups_enabled retained_backups < <(
  gcloud sql instances describe "$SQL_INSTANCE" \
    --project="$PROJECT_ID" \
    --format='value(state,settings.deletionProtectionEnabled,settings.backupConfiguration.enabled,settings.backupConfiguration.backupRetentionSettings.retainedBackups)'
)

[[ "$sql_state" == "RUNNABLE" ]] ||
  fail "Cloud SQL instance is not RUNNABLE: $sql_state"
is_true "$deletion_protection" ||
  fail "Cloud SQL deletion protection is disabled"
is_true "$backups_enabled" ||
  fail "Cloud SQL automated backups are disabled"
[[ "${retained_backups:-0}" -ge 7 ]] ||
  fail "Cloud SQL retains fewer than 7 backups: ${retained_backups:-0}"

read -r backup_status backup_start < <(
  gcloud sql backups list \
    --project="$PROJECT_ID" \
    --instance="$SQL_INSTANCE" \
    --limit=1 \
    --sort-by=~startTime \
    --format='value(status,startTime)'
)

[[ "$backup_status" == "SUCCESSFUL" ]] ||
  fail "latest Cloud SQL backup is not successful: ${backup_status:-missing}"
[[ -n "$backup_start" ]] ||
  fail "latest Cloud SQL backup has no start time"

BACKUP_START="$backup_start" MAX_AGE_HOURS="$MAX_BACKUP_AGE_HOURS" python3 - <<'PY'
import os
from datetime import datetime, timezone

started = datetime.fromisoformat(os.environ["BACKUP_START"].replace("Z", "+00:00"))
age_hours = (datetime.now(timezone.utc) - started).total_seconds() / 3600
max_age = float(os.environ["MAX_AGE_HOURS"])
if age_hours > max_age:
    raise SystemExit(
        f"ERROR: latest Cloud SQL backup is {age_hours:.1f} hours old; "
        f"maximum allowed age is {max_age:.1f} hours"
    )
print(f"Cloud SQL backup age: {age_hours:.1f} hours")
PY

"$SCRIPT_DIR/verify-api-key-schema.sh"
"$SCRIPT_DIR/verify-stripe-payment-schema.sh"
"$SCRIPT_DIR/verify-redis-traffic-readiness.sh"
"$SCRIPT_DIR/verify-outbound-security-readiness.sh"
"$SCRIPT_DIR/verify-web-security-readiness.sh"
"$SCRIPT_DIR/verify-production-config.sh"

read -r ready_revision traffic_percent ready_status < <(
  gcloud run services describe "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format='value(status.latestReadyRevisionName,status.traffic[0].percent,status.conditions[0].status)'
)

[[ -n "$ready_revision" ]] ||
  fail "Cloud Run has no ready revision"
[[ "$traffic_percent" == "100" ]] ||
  fail "Cloud Run latest traffic is not 100%: ${traffic_percent:-missing}"
is_true "$ready_status" ||
  fail "Cloud Run service is not ready"

printf 'Production readiness passed.\n'
printf '  project: %s\n' "$PROJECT_ID"
printf '  Cloud SQL: %s (deletion protection on, %s backups retained)\n' \
  "$SQL_INSTANCE" "$retained_backups"
printf '  Cloud Run: %s (%s, %s%% traffic)\n' \
  "$SERVICE" "$ready_revision" "$traffic_percent"
