#!/usr/bin/env bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

require_command corepack
require_command curl
verify_checkout

curl --fail --silent --show-error --max-time 30 "${FORMBRICKS_URL}" >/dev/null ||
  fail "Formbricks is not reachable at ${FORMBRICKS_URL}. Run pnpm lab:dev in another terminal."

formbricks_pnpm exec playwright test \
  apps/web/playwright/onboarding.spec.ts \
  --grep 'start from scratch' \
  --reporter=list \
  --workers=1
