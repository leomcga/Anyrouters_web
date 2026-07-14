#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^redesign[0-9]+$ ]]; then
  printf 'Usage: %s redesignN\n' "$0" >&2
  exit 2
fi

TAG="$1"
PROJECT_ID="${PROJECT_ID:-anyrouters-prod}"
REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-newapi}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/anyrouters/new-api:${TAG}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"
"$ROOT/ops/verify-production-readiness.sh"

gcloud builds submit --project="$PROJECT_ID" --tag "$IMAGE" .
gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --image "$IMAGE" \
  --region "$REGION" \
  --quiet

status_code="$(curl -L -sS -o /dev/null -w '%{http_code}' \
  'https://api.anyrouters.com/api/status')"
[[ "$status_code" == "200" ]] || {
  printf 'ERROR: production status endpoint returned HTTP %s\n' "$status_code" >&2
  exit 1
}

revision="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(status.latestReadyRevisionName)')"

printf 'Deployment complete: %s -> %s\n' "$TAG" "$revision"
