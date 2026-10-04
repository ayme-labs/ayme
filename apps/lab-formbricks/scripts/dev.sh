#!/usr/bin/env bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

require_command corepack
require_command docker
verify_checkout

docker info >/dev/null 2>&1 || fail "Docker Desktop is not running."

printf 'Starting Formbricks at %s.\n' "${FORMBRICKS_URL}"
formbricks_pnpm go
