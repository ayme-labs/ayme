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
# Images ship either Playwright's older layout (chrome-linux for both browsers)
# or its newer one (chrome-linux64, chrome-headless-shell-linux64). Only the
# shipped build has a real directory there; the revisions this script links
# hold a symlink instead.
browsers="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
if [ ! -d "$browsers" ]; then
  exit 0
fi

# Prints the newest shipped build of $1 as <dir>/<layout>, e.g.
# chromium-1243/chrome-linux64, or nothing.
shipped_build() {
  local dir=$1
  shift
  local layout layouts=()
  for layout in "$@"; do
    layouts+=(-o -path "$browsers/$dir-[0-9]*/$layout")
  done
  find "$browsers" -mindepth 2 -maxdepth 2 -type d \( "${layouts[@]:1}" \) -printf '%P\n' | sort -V | tail -1
}

shopt -s nullglob
manifests=(node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/browsers.json)

pinned() {
  jq -r --arg name "$1" '.browsers[] | select(.name == $name) | .revision' "${manifests[@]}" </dev/null | sort -u
}

shipped=$(shipped_build chromium chrome-linux chrome-linux64)
if [ -n "$shipped" ]; then
  for rev in $(pinned chromium); do
    full="$browsers/chromium-$rev"
    if [ "$full" != "$browsers/${shipped%/*}" ] && [ ! -e "$full/INSTALLATION_COMPLETE" ]; then
      mkdir -p "$full"
      ln -sfn "$browsers/$shipped" "$full/chrome-linux64"
      touch "$full/INSTALLATION_COMPLETE"
    fi
  done
fi

shipped=$(shipped_build chromium_headless_shell chrome-linux chrome-headless-shell-linux64)
if [ -n "$shipped" ]; then
  for rev in $(pinned chromium-headless-shell); do
    shell="$browsers/chromium_headless_shell-$rev"
    if [ "$shell" != "$browsers/${shipped%/*}" ] && [ ! -e "$shell/INSTALLATION_COMPLETE" ]; then
      if [ "${shipped##*/}" = chrome-linux ]; then
        mkdir -p "$shell/headless-shell"
        ln -sf "$browsers/$shipped/"* "$shell/headless-shell/"
        ln -sf headless_shell "$shell/headless-shell/chrome-headless-shell"
        ln -sfn headless-shell "$shell/chrome-headless-shell-linux64"
      else
        mkdir -p "$shell"
        ln -sfn "$browsers/$shipped" "$shell/chrome-headless-shell-linux64"
      fi
      touch "$shell/INSTALLATION_COMPLETE"
    fi
  done
fi
