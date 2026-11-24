import js from "@eslint/js";
import tseslint from "typescript-eslint";
import testingEntries from "./testing-entries.js";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...testingEntries,
  {
    // A TODO-style comment is a promise nothing tracks: open an issue instead.
    rules: {
      "no-warning-comments": [
        "error",
        { terms: ["todo", "fixme", "hack", "xxx"], location: "anywhere" },
      ],
    },
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
