#!/usr/bin/env bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

require_command corepack
require_command curl
verify_checkout

# The first request compiles the page, which takes a while on a fresh dev server.
curl --fail --silent --show-error --max-time 300 "${FORMBRICKS_URL}/auth/login" >/dev/null ||
  fail "Formbricks is not reachable at ${FORMBRICKS_URL}. Run pnpm lab:dev in another terminal."

formbricks_pnpm exec playwright test --config apps/web/ayme/qualification/playwright.config.ts
verify_checkout
