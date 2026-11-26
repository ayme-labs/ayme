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

// Getting and releasing a browser drives a real one, which the unit tests
// do not measure (docs/testing.md#code-a-real-browser-runs), so plain logic,
// which they measure, stays out of it: only the front door reaches it, to
// hand it out.
const noLive = {
  regex: String.raw`^\.\.?/(.*/)?live/`,
  message:
    "Only the front door reaches infrastructure/live (docs/testing.md#code-a-real-browser-runs).",
};

// esquery reads `/` as the end of a regex, so selectors match it as `\x2F`.
const selector = (node, regex) =>
  `${node}[source.value=/${regex.replaceAll("/", String.raw`\x2F`)}/]`;

/** The import rules of production code in `files`, which may not import
 * what `patterns` name. */
const restricted = (files, patterns, ignores) => ({
  files,
  ignores: [...testFiles, ...ignores],
  rules: {
    "@typescript-eslint/no-restricted-imports": ["error", { patterns }],
    // A dynamic import() always loads a value; a type written as
    // import("…") is refused unless the pattern allows types.
    "no-restricted-syntax": [
      "error",
      ...patterns.flatMap(({ regex, message, allowTypeImports }) => [
        { selector: selector("ImportExpression", regex), message },
        ...(allowTypeImports
          ? []
          : [{ selector: selector("TSImportType", regex), message }]),
      ]),
      // A module in backticks, which the selectors above do not read.
      {
        selector:
          'ImportExpression[source.type="TemplateLiteral"][source.expressions.length=0]',
        message:
          "Write the module in import() as a quoted string, so lint can check it.",
      },
    ],
  },
});

const live = "src/infrastructure/live/**";

export default [
  ...config,
  restricted(
    ["src/**/*.ts"],
    [playwrightTypesOnly, otherEffectPackages, noLive],
    [live, "src/index.ts"]
  ),
  restricted(
    [live, "src/index.ts"],
    [playwrightTypesOnly, otherEffectPackages],
    []
  ),
];
