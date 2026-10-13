#!/bin/bash
# Prepares the ayme checkout or worktree containing the current directory so
# the pre-commit hook passes in a Claude Code cloud container. Safe to re-run.
# Does nothing on a local machine.
#
#   scripts/prepare-cloud-checkout.sh
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$(git rev-parse --show-toplevel)"

pnpm install
# `pnpm install` runs this through `prepare` only when it changes something.
scripts/link-cloud-browsers.sh
