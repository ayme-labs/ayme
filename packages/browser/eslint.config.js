import config from "@ayme-dev/eslint-config/base";

// This file is the source of truth for the package's import rules;
// packages/browser/AGENTS.md introduces them, and src/layout.test.ts checks
// them.

const testFiles = ["src/**/*.test.ts"];

// The package brings no Playwright of its own: it loads the project's
// (ADR-0052), so its code names Playwright's types only. Its tests drive a
// browser of their own over this package's Playwright.
const playwrightTypesOnly = {
  regex: "^(@playwright/|playwright(-core)?(/|$))",
  allowTypeImports: true,
  message:
    "The browser package loads the project's own Playwright and imports Playwright's types only (docs/adr/0052-the-recorder-runs-on-stock-playwright-and-uses-its-private-parts-only-under-test.md).",
};
const otherEffectPackages = {
  regex: "^(@effect/|effect/unstable(/|$))",
  message:
    "Production code uses only the stable effect package: no @effect/* package and no effect/unstable module.",
};

// esquery reads `/` as the end of a regex, so selectors match it as `\x2F`.
const selector = (regex) =>
  `ImportExpression[source.value=/${regex.replaceAll("/", String.raw`\x2F`)}/]`;

export default [
  ...config,
  {
    files: ["src/**/*.ts"],
    ignores: testFiles,
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [playwrightTypesOnly, otherEffectPackages] },
      ],
      // A dynamic import() always loads a value.
      "no-restricted-syntax": [
        "error",
        ...[playwrightTypesOnly, otherEffectPackages].map(
          ({ regex, message }) => ({ selector: selector(regex), message })
        ),
      ],
    },
  },
];
