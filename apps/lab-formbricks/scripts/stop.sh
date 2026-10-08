#!/usr/bin/env bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

require_command corepack
verify_checkout

# Stops the containers and keeps their volumes. There is deliberately no reset command.
formbricks_pnpm db:down
