#!/usr/bin/env bash
# Usage: run.sh <candidate.json>...   (inside Devbox)
set -euo pipefail
H="$(cd "$(dirname "$0")" && pwd)"
export PROBE_SCRATCH="${PROBE_SCRATCH:?}"
for c in "$@"; do node "$H/probe.mjs" "$H/candidates/$c"; done
