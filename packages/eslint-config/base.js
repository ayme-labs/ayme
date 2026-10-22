import js from "@eslint/js";
import tseslint from "typescript-eslint";
import testingEntries from "./testing-entries.js";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...testingEntries,
  {
    // `import { type T }` keeps an empty runtime import under
    // verbatimModuleSyntax; `import type { T }` leaves none, which
    // scripts/check-cycles.mjs relies on.
    rules: { "@typescript-eslint/no-import-type-side-effects": "error" },
  },
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
];
