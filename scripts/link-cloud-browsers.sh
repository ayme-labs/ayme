#!/bin/bash
# Gives Playwright the Chromium it expects in a Claude Code cloud container.
# Runs from the root `prepare` script, so the `pnpm install` of a fresh
# checkout, a worktree or a Playwright bump needs no extra step. Does nothing
# on a local machine or in CI.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# The container ships one Chromium build, but each installed Playwright pins
# its own revision. Expose the shipped build under every pinned revision.
# Only the shipped build has a real chrome-linux directory; the revisions this
# script links have a chrome-linux64 symlink instead.
browsers="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
shipped=$(find "$browsers" -mindepth 2 -maxdepth 2 -type d -name chrome-linux -path '*/chromium-[0-9]*/chrome-linux' -printf '%h\n' | sed 's/.*chromium-//' | sort -n | tail -1)
if [ -z "$shipped" ]; then
  exit 0
fi

shopt -s nullglob
manifests=(node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/browsers.json)

for rev in $(jq -r '.browsers[] | select(.name == "chromium") | .revision' "${manifests[@]}" </dev/null | sort -u); do
  full="$browsers/chromium-$rev"
  if [ "$rev" != "$shipped" ] && [ ! -e "$full/INSTALLATION_COMPLETE" ]; then
    mkdir -p "$full"
    ln -sfn "$browsers/chromium-$shipped/chrome-linux" "$full/chrome-linux64"
    touch "$full/INSTALLATION_COMPLETE"
  fi
done

for rev in $(jq -r '.browsers[] | select(.name == "chromium-headless-shell") | .revision' "${manifests[@]}" </dev/null | sort -u); do
  shell="$browsers/chromium_headless_shell-$rev"
  if [ "$rev" != "$shipped" ] && [ ! -e "$shell/INSTALLATION_COMPLETE" ]; then
    mkdir -p "$shell/chrome-headless-shell-linux64"
    ln -sf "$browsers/chromium_headless_shell-$shipped/chrome-linux/"* "$shell/chrome-headless-shell-linux64/"
    ln -sf headless_shell "$shell/chrome-headless-shell-linux64/chrome-headless-shell"
    touch "$shell/INSTALLATION_COMPLETE"
  fi
done
