#!/usr/bin/env sh
set -eu
# Run from the repository root, inside Devbox. Setup runs once; builds are cached.
if [ ! -d node_modules/.pnpm ]; then
  pnpm install --frozen-lockfile
fi
if [ ! -d diagnostics/issue-959/vendor/node_modules ]; then
  npm --prefix diagnostics/issue-959/vendor ci --ignore-scripts --no-audit --no-fund
fi
pnpm exec turbo run build --filter=@ayme-dev/ayme --filter=@ayme-dev/mcp --filter=@ayme-dev/unplugin-ayme >/dev/null
exec node diagnostics/issue-959/run.mjs
