import js from "@eslint/js";
import tseslint from "typescript-eslint";
import testingEntries from "./testing-entries.js";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...testingEntries,
  {
    // A TODO-style comment is a promise nothing tracks: open an issue instead.
    // Only a comment that opens with the term: a name such as `Todo.close`
    // inside a sentence is no promise.
    rules: {
      "no-warning-comments": [
        "error",
        {
          terms: ["todo", "fixme", "hack", "xxx"],
          location: "start",
          // A doc comment opens with `*`: `/** TODO: later */` counts too.
          decoration: ["*"],
        },
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
