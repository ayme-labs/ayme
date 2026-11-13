import config from "@ayme-dev/eslint-config/base";

const patterns = [
  {
    // The recorder runs on the Playwright of the project it is started in
    // (ADR-0052). Only the engine's playwright slice loads it.
    regex: "^(@playwright/|playwright(-core)?(/|$))",
    message:
      "The CLI brings no Playwright of its own: the engine loads the project's (docs/adr/0052-the-recorder-runs-on-stock-playwright-and-uses-its-private-parts-only-under-test.md).",
  },
  {
    regex: "^(@effect/|effect(/|$))",
    message:
      "No Effect in the CLI: it stays inside the engine, behind its front door.",
  },
];

export default [
  ...config,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns }],
      // The same rules for a dynamic import(). esquery reads `/` as the end
      // of a regex, so selectors match it as `\x2F`.
      "no-restricted-syntax": [
        "error",
        ...patterns.map(({ regex, message }) => ({
          selector: `ImportExpression[source.value=/${regex.replaceAll("/", String.raw`\x2F`)}/]`,
          message,
        })),
      ],
    },
  },
];
