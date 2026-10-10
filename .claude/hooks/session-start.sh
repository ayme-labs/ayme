#!/bin/bash
# Prepares a Claude Code cloud container so the pre-commit hook passes.
# Runs only when a session opens in this repository; see
# scripts/prepare-cloud-checkout.sh for checkouts and worktrees it misses.
set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"
exec scripts/prepare-cloud-checkout.sh
