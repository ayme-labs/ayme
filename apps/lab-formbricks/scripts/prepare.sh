#!/usr/bin/env bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

require_command corepack
require_command git
require_command node
require_command pnpm
require_command tar

if [[ -e "${FORMBRICKS_DIR}/.git" ]] && is_dirty; then
  fail "Refusing to change a dirty Formbricks checkout at ${FORMBRICKS_DIR}"
fi

# The submodule is declared with update = none, so only an explicit --checkout fetches it.
git -C "${REPO_ROOT}" submodule update --init --checkout --filter=blob:none -- "${SUBMODULE_PATH}"
verify_checkout

# Pack the Ayme packages from this checkout as they would be published, and unpack them
# where the Ayme overlay's package.json and pnpm overrides point. The overlay ignores the folder.
readonly AYME_PACKAGES=(ayme react unplugin-ayme)
readonly PACKED_DIR="${FORMBRICKS_DIR}/.ayme-lab/packages"
readonly TARBALL_DIR="${FORMBRICKS_DIR}/.ayme-lab/tarballs"

printf 'Building and packing the Ayme packages from %s.\n' "$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
build_filters=()
for name in "${AYME_PACKAGES[@]}"; do
  build_filters+=("--filter=@ayme-dev/${name}")
done
pnpm --dir "${REPO_ROOT}" exec turbo run build "${build_filters[@]}" --output-logs=errors-only

rm -rf "${PACKED_DIR}" "${TARBALL_DIR}"
mkdir -p "${PACKED_DIR}" "${TARBALL_DIR}"
for name in "${AYME_PACKAGES[@]}"; do
  tarball="$(pnpm --dir "${REPO_ROOT}/packages/${name}" pack --json --pack-destination "${TARBALL_DIR}" |
    node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).filename)')"
  mkdir -p "${PACKED_DIR}/${name}"
  tar xzf "${tarball}" -C "${PACKED_DIR}/${name}" --strip-components=1
done

# pnpm copies a directory dependency once and then reports "Already up to date", so remove
# the installed copies and pnpm's install state to make it copy the fresh packages.
rm -rf "${FORMBRICKS_DIR}/node_modules/@ayme-dev" "${FORMBRICKS_DIR}/apps/web/node_modules/@ayme-dev"
rm -f "${FORMBRICKS_DIR}/node_modules/.pnpm-workspace-state-v1.json"

# Not frozen: a frozen install does not compare the packed manifests with the lockfile.
# When the Ayme packages' dependencies change, this rewrites the overlay's lockfile and
# the check below fails.
formbricks_pnpm install --recursive --no-frozen-lockfile
if is_dirty; then
  fail "The Ayme packages' dependencies no longer match the Ayme overlay's lockfile. Regenerate it as the README's \"Moving the pin\" section describes."
fi
verify_checkout

if [[ ! -f "${FORMBRICKS_DIR}/.env" ]]; then
  formbricks_pnpm dev:setup
fi

printf 'Formbricks is ready at %s (%s).\n' "${FORMBRICKS_DIR}" "$(pinned_revision)"
