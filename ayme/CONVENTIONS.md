# ayme conventions

- To run ayme in a state, inside Devbox: `pnpm install --frozen-lockfile`, then
  build one example app's dependencies with
  `pnpm exec turbo run build --filter='@ayme-dev/example-<app>^...' --concurrency=50%`,
  then start that app with `pnpm -C apps/example-<app> dev`. Rebuild after
  switching states: the app runs the packages' built output.

## Product surfaces

- Keep `ayme/product-surfaces/surfaces.ts` to plain literal values: type-only
  imports and the exported `consumers` and `surfaces` constants. Write no
  computed values, spreads, function calls or other statements. Another tool
  reads this file as text without running it.
