#!/usr/bin/env bash
set -euo pipefail

readonly LAB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT="$(git -C "${LAB_DIR}" rev-parse --show-toplevel)"
readonly SUBMODULE_PATH="apps/lab-formbricks/formbricks"
readonly FORMBRICKS_DIR="${REPO_ROOT}/${SUBMODULE_PATH}"
readonly FORMBRICKS_URL="http://localhost:3000"

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

pinned_revision() {
  git -C "${REPO_ROOT}" ls-files --stage -- "${SUBMODULE_PATH}" | cut -d " " -f 2
}

is_dirty() {
  [[ -n "$(git -C "${FORMBRICKS_DIR}" status --porcelain)" ]]
}

verify_checkout() {
  [[ -e "${FORMBRICKS_DIR}/.git" ]] || fail "Formbricks is not prepared. Run pnpm lab:prepare first."

  local pinned actual
  pinned="$(pinned_revision)"
  actual="$(git -C "${FORMBRICKS_DIR}" rev-parse HEAD)"
  [[ "${actual}" == "${pinned}" ]] || fail "Expected Formbricks ${pinned}, found ${actual}. Run pnpm lab:prepare."

  ! is_dirty || fail "Refusing to use a dirty Formbricks checkout at ${FORMBRICKS_DIR}"
}

# Formbricks declares its own pnpm version, which differs from this repo's.
formbricks_pnpm() {
  local package_manager
  package_manager="$(node -p "require('${FORMBRICKS_DIR}/package.json').packageManager")"
  corepack "${package_manager}" --dir "${FORMBRICKS_DIR}" "$@"
}
