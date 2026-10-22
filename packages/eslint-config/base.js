import js from "@eslint/js";
import tseslint from "typescript-eslint";
import testingEntries from "./testing-entries.js";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...testingEntries,
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
];
