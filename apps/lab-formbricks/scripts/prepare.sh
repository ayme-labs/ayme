#!/usr/bin/env bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

require_command corepack
require_command git
require_command node
require_command pnpm

if [[ -e "${FORMBRICKS_DIR}/.git" ]] && is_dirty; then
  fail "Refusing to change a dirty Formbricks checkout at ${FORMBRICKS_DIR}"
fi

# The submodule is declared with update = none, so only an explicit --checkout fetches it.
git -C "${REPO_ROOT}" submodule update --init --checkout --filter=blob:none -- "${SUBMODULE_PATH}"
verify_checkout

# Formbricks is installed as its own lockfile says: nothing of Ayme goes into it.
formbricks_pnpm install --recursive --frozen-lockfile
verify_checkout

if [[ ! -f "${FORMBRICKS_DIR}/.env" ]]; then
  formbricks_pnpm dev:setup
fi

# ayme mcp serves the Page Objects in .ayme/ with the Ayme packages of this checkout, so build
# the ones this package depends on.
printf 'Building the Ayme packages from %s.\n' "$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
pnpm --dir "${REPO_ROOT}" exec turbo run build --filter='@ayme-dev/lab-formbricks^...' --output-logs=errors-only

printf 'Formbricks is ready at %s (%s).\n' "${FORMBRICKS_DIR}" "$(pinned_revision)"
