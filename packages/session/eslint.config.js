import config from "@ayme-dev/eslint-config/base";
import {
  boundariesPlugin,
  horizontalBoundaries,
} from "@ayme-dev/eslint-config/horizontal-boundaries";

// The source layout's rules. packages/session/AGENTS.md introduces them;
// this file is the source of truth, and src/layout.test.ts checks it.

const packageRoot = import.meta.dirname;

// The slices of src/, and the slices each may use. Every folder of src/ is
// one, and each is layered (src/<slice>/<layer>/); src/index.ts is the
// package's front door. Test support lives in testing/ beside src/
// (ADR-0057).
const allowedSlices = {
  session: [],
  playwright: ["session"],
  process: ["session", "playwright"],
};
const slices = Object.keys(allowedSlices);
const testFiles = ["src/**/*.test.ts"];

// esquery reads `/` as the end of a regex, so selectors match it as `\x2F`.
const selector = (regex) =>
  `ImportExpression[source.value=/${regex.replaceAll("/", String.raw`\x2F`)}/]`;

/** The import rules of one group of files: static imports, a dynamic
 * import(), which always loads a value, and a type written as import("…"). */
function restricted(files, patterns, { ignores } = {}) {
  return {
    files,
    ...(ignores ? { ignores } : {}),
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns }],
      "no-restricted-syntax": [
        "error",
        ...patterns.map(({ regex, message }) => ({
          selector: selector(regex),
          message,
        })),
      ],
    },
  };
}

// The Session runs on the project's own Playwright, which @ayme-dev/browser
// loads (ADR-0052): code names Playwright's types only, and only the
// playwright slice reaches the browser.
const playwrightTypesOnly = {
  regex: "^(@playwright/|playwright(-core)?(/|$))",
  allowTypeImports: true,
  message:
    "The Session loads the project's own Playwright through @ayme-dev/browser and imports Playwright's types only (docs/adr/0052-the-recorder-runs-on-stock-playwright-and-uses-its-private-parts-only-under-test.md).",
};
const playwrightOutsideItsSlice = {
  regex: "^(@playwright/|playwright(-core)?(/|$)|@ayme-dev/browser$)",
  message:
    "Only the playwright slice reaches Playwright and @ayme-dev/browser: the Session sees its browser through its port, SessionBrowser.",
};
const anyEffect = {
  regex: "^(@effect/|effect(/|$))",
  message:
    "No Effect here: the domain layers and the front door, which hands the CLI promises and plain data, stay without it.",
};
const otherEffectPackages = {
  regex: "^(@effect/|effect/unstable(/|$))",
  message:
    "Production code uses only the stable effect package: no @effect/* package and no effect/unstable module.",
};
// A slice reaches another only through the front door of the layer it uses,
// its layer folder's index.ts, so the layer rule judges each import by its
// layer (ADR-0046); a slice has no front door of its own. Code in a slice
// reaches another slice through "../"; the package's front door, beside the
// slices, through "./".
const pastFrontDoor = (prefix) =>
  String.raw`^${prefix}(${slices.join("|")})(/(domain|application|infrastructure)/(?!index(\.[jt]s)?$).+|(/index(\.[jt]s)?)?$)`;
const frontDoorMessage =
  "Import another slice through the front door of the layer you use, such as ../../playwright/infrastructure (docs/adr/0046-the-layer-order-holds-across-slices-through-one-front-door-per-layer.md).";
const frontDoor = {
  regex: pastFrontDoor(String.raw`(\.\./)+(.*/)?`),
  message: frontDoorMessage,
};
const frontDoorFromRoot = {
  regex: pastFrontDoor(String.raw`\./`),
  message: frontDoorMessage,
};
// Code that drives a real browser is measured by the command's end-to-end
// tests (docs/testing.md#code-a-real-browser-runs), so plain logic, which
// unit tests measure, stays out of it: only the layer's front door reaches
// it, to hand out the adapter.
const live = "src/playwright/infrastructure/live/**";
const noLive = {
  regex: String.raw`^\.\.?/(.*/)?live/`,
  message:
    "Only the front door of the playwright slice's infrastructure reaches infrastructure/live (docs/testing.md#code-a-real-browser-runs).",
};

export default [
  ...config,
  ...horizontalBoundaries({ packageRoot, enforcedSlices: slices }),
  {
    files: ["src/**/*.ts"],
    ignores: testFiles,
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
    },
  },
  // Each group states all of its patterns: a later rule replaces an
  // earlier one for the same file.
  restricted(
    ["src/**/*.ts"],
    [
      playwrightTypesOnly,
      playwrightOutsideItsSlice,
      otherEffectPackages,
      frontDoor,
    ],
    { ignores: [...testFiles, "src/playwright/**"] }
  ),
  restricted(
    ["src/playwright/**/*.ts"],
    [playwrightTypesOnly, otherEffectPackages, noLive, frontDoor],
    { ignores: [...testFiles, live, "src/playwright/infrastructure/index.ts"] }
  ),
  restricted(
    [live, "src/playwright/infrastructure/index.ts"],
    [playwrightTypesOnly, otherEffectPackages, frontDoor],
    { ignores: testFiles }
  ),
  restricted(
    ["src/*/domain/**/*.ts"],
    [playwrightTypesOnly, playwrightOutsideItsSlice, anyEffect, frontDoor],
    { ignores: testFiles }
  ),
  restricted(
    ["src/index.ts"],
    [
      playwrightTypesOnly,
      playwrightOutsideItsSlice,
      anyEffect,
      frontDoorFromRoot,
    ],
    { ignores: testFiles }
  ),
];
