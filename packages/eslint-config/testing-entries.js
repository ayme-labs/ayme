// ESLint's unstable API, used to alias the built-in rules under a plugin name
// so this policy cannot collide with other uses of them.
import { builtinRules } from "eslint/use-at-your-own-risk";

// ADR-0026: only tests and a package's verification scripts may import a
// `testing` entry, whether `@ayme-dev/<package>/testing` or a relative
// `./testing` inside the package.
export const message =
  "Only test files may import a testing entry (docs/adr/0026-test-seams-behind-a-testing-entry.md).";
const packageEntry = String.raw`^@ayme-dev/.+/testing$`;
const relativeEntry = String.raw`^\.{1,2}/(.+/)?testing(\.[cm]?[jt]sx?)?$`;
// esquery reads `/` as the end of a regex, so selectors match it as `\x2F`.
const selectorPattern = (pattern) => pattern.replaceAll("/", String.raw`\x2F`);
const specifier = `/${selectorPattern(packageEntry)}|${selectorPattern(relativeEntry)}/`;

export const plugin = "testing-entries";

export default [
  {
    name: "@ayme-dev/testing-entries",
    ignores: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.browser.test.ts",
      "**/tests/**",
      "scripts/**",
    ],
    // Aliased so these restrictions cannot collide with other uses of the
    // built-in rules.
    plugins: {
      [plugin]: {
        rules: {
          "no-restricted-imports": builtinRules.get("no-restricted-imports"),
          "no-restricted-syntax": builtinRules.get("no-restricted-syntax"),
        },
      },
    },
    rules: {
      [`${plugin}/no-restricted-imports`]: [
        "error",
        {
          patterns: [
            { regex: packageEntry, message },
            { regex: relativeEntry, message },
          ],
        },
      ],
      [`${plugin}/no-restricted-syntax`]: [
        "error",
        { selector: `ImportExpression[source.value=${specifier}]`, message },
        {
          selector: `CallExpression[callee.name='require'][arguments.0.value=${specifier}]`,
          message,
        },
      ],
    },
  },
];
