#!/usr/bin/env bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

require_command corepack
require_command docker
verify_checkout

docker info >/dev/null 2>&1 || fail "Docker Desktop is not running."

survey_scope_ready() {
  docker compose -f "${FORMBRICKS_DIR}/docker-compose.dev.yml" exec -T postgres \
    psql -U postgres -d formbricks -tAc \
    "SELECT \"readyAt\" IS NOT NULL FROM \"AuthzedProjectionScopeState\" WHERE scope = 'survey'" 2>/dev/null |
    grep -qx t
}

# Formbricks's authorization CLI prints one JSON result line and then does not exit,
# so it runs in its own process group and is stopped once the line appears.
authorization_cli() {
  local output
  output="$(mktemp)"
  set -m
  formbricks_pnpm "$@" >"${output}" 2>&1 &
  local pid=$!
  set +m
  while kill -0 "${pid}" 2>/dev/null && ! grep -q '^{' "${output}"; do
    sleep 0.5
  done
  kill -- "-${pid}" 2>/dev/null || true
  wait "${pid}" 2>/dev/null || true
  grep -q '"status":"reconciled"' "${output}" || fail "Formbricks authorization ${*} did not reconcile. Output: ${output}"
  rm -f "${output}"
}

# Run in the authorization state Formbricks's own CI calls production: project the
# existing data, then mark the survey scope ready, so a new survey starts restricted.
# Both steps run once; the marker lives in the Docker volume.
if ! survey_scope_ready; then
  printf 'Preparing Formbricks authorization (first start only).\n'
  formbricks_pnpm db:up
  formbricks_pnpm dev:authzed
  authorization_cli authzed:backfill --apply
  authorization_cli authzed:backfill --scope=survey --apply --mark-ready
  survey_scope_ready || fail "The Formbricks survey readiness marker is not set."
fi

printf 'Starting Formbricks at %s.\n' "${FORMBRICKS_URL}"
formbricks_pnpm go
