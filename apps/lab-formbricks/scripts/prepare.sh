#!/usr/bin/env bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

require_command corepack
require_command git
require_command node

if [[ -e "${FORMBRICKS_DIR}/.git" ]] && is_dirty; then
  fail "Refusing to change a dirty Formbricks checkout at ${FORMBRICKS_DIR}"
fi

# The submodule is declared with update = none, so only an explicit --checkout fetches it.
git -C "${REPO_ROOT}" submodule update --init --checkout --filter=blob:none -- "${SUBMODULE_PATH}"
verify_checkout

formbricks_pnpm install --recursive --frozen-lockfile

if [[ ! -f "${FORMBRICKS_DIR}/.env" ]]; then
  formbricks_pnpm dev:setup
fi

printf 'Formbricks is ready at %s (%s).\n' "${FORMBRICKS_DIR}" "$(pinned_revision)"
