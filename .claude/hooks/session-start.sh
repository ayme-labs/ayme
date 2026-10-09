#!/bin/bash
# Prepares a Claude Code cloud container so the pre-commit hook passes.
# Does nothing on a local machine.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

pnpm install

# The container ships one Chromium build, but each installed Playwright pins
# its own revision. Expose the shipped build under every pinned revision.
browsers="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
shipped=$(find "$browsers" -maxdepth 1 -type d -name 'chromium-[0-9]*' -printf '%f\n' | sed 's/chromium-//' | sort -n | tail -1)
if [ -n "$shipped" ]; then
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
fi
