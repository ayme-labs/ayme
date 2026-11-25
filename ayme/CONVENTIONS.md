# ayme conventions

## Product surfaces

- Keep `ayme/product-surfaces/surfaces.ts` to plain literal values: type-only
  imports and the exported `consumers` and `surfaces` constants. Write no
  computed values, spreads, function calls or other statements. Another tool
  reads this file as text without running it.
