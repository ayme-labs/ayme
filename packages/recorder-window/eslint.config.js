import config from "@ayme-dev/eslint-config/base";
import {
  boundariesPlugin,
  horizontalBoundaries,
} from "@ayme-dev/eslint-config/horizontal-boundaries";

// The source layout's rules: this file is their source of truth. The slices
// are a start, named as the Inspector's are; the window's first content may
// rename them.

const packageRoot = import.meta.dirname;

// The slices of src/, and the slices each may use: only those listed before
// it here. app composes them, and nothing uses app.
const allowedSlices = {
  shared: [],
  app: ["shared"],
};
const slices = Object.keys(allowedSlices);
const sourceFiles = "src/**/*.{ts,tsx}";

const patterns = [
  {
    // A relative import beneath another slice, past its front door.
    regex: `^\\.\\.?/(.*/)?(${slices.join("|")})/(?!index(\\.[jt]sx?)?$)`,
    message: "Import another slice through its index.ts.",
  },
  {
    regex: "^@ayme-dev/recorder(/(?!contract$).*)?$",
    message:
      "The window knows the engine only through @ayme-dev/recorder/contract, its plain data: it never imports engine code.",
  },
  {
    regex: "^(@playwright/|playwright(-core)?(/|$))",
    message:
      "Only the engine's playwright slice imports Playwright (docs/adr/0052-the-recorder-runs-on-stock-playwright-and-uses-its-private-parts-only-under-test.md).",
  },
  {
    regex: "^(@effect/|effect(/|$))",
    message: "No Effect in the window: it stays inside the engine.",
  },
];

export default [
  ...config,
  ...horizontalBoundaries({
    packageRoot,
    // app isn't layered.
    enforcedSlices: slices.filter((slice) => slice !== "app"),
  }),
  {
    files: [sourceFiles],
    plugins: { "slice-boundaries": boundariesPlugin },
    rules: {
      "slice-boundaries/dependencies": [
        "error",
        {
          default: "allow",
          checkAllOrigins: false,
          checkUnknownLocals: false,
          policies: slices.map((slice) => ({
            from: { element: { captured: { slice } } },
            disallow: {
              to: {
                element: {
                  captured: {
                    slice: slices.filter(
                      (target) =>
                        target !== slice &&
                        !allowedSlices[slice].includes(target)
                    ),
                  },
                },
              },
            },
            message: `${slice} may only use ${[...allowedSlices[slice], "itself"].join(", ")}.`,
          })),
        },
      ],
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
