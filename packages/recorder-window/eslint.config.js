import config from "@ayme-dev/eslint-config/base";
import {
  boundariesPlugin,
  horizontalBoundaries,
} from "@ayme-dev/eslint-config/horizontal-boundaries";

// The source layout's rules; this file is the source of truth.
// packages/recorder-window/AGENTS.md holds the rules lint cannot see.

const packageRoot = import.meta.dirname;

// The slices of src/, and the slices each may use: only those listed before
// it here. app composes them, and nothing uses app. Test support, the
// window's page objects included, lives in testing/ beside src/ (ADR-0057).
const allowedSlices = {
  // The window's and the toolbar's channel to the recorder, and the newest
  // state heard on it.
  channel: [],
  // The recording as the window lists it: its Visits, entries, chips and
  // change rows, and the window's title.
  timeline: [],
  // The window's controls, its status and theme, and the toolbar's pill.
  controls: [],
  // The window's and the toolbar's scripts, which mount them, the window's
  // page, and their stylesheets.
  app: ["controls", "timeline", "channel"],
};
const slices = Object.keys(allowedSlices);
const unlayered = ["app"];
const sourceFiles = "src/**/*.{ts,tsx}";

/** A relative import beneath one of `others`, past its front door. A path
 * through testing/ is test support, which has no front door. */
const frontDoor = (others) => ({
  regex: `^\\.\\.?/(?!(.*/)?testing/)(.*/)?(${others.join("|")})/(?!index(\\.[jt]sx?)?$)`,
  message: "Import another slice through its index.ts.",
});

const patterns = [
  frontDoor(slices),
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

/** The rules for `files`, which may import what `patterns` names. */
function restricted(files, patterns, { ignores } = {}) {
  return {
    files,
    ...(ignores ? { ignores } : {}),
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
  };
}

/** Which slices the files of each slice may use. */
function sliceBoundaries(files, { ignores } = {}) {
  return {
    files,
    ...(ignores ? { ignores } : {}),
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
  };
}

// The page objects take Playwright's types, as a test does.
const pageObjects = ["testing/**/*.{ts,tsx}"];
const playwrightPattern = patterns[2];

export default [
  ...config,
  ...horizontalBoundaries({
    packageRoot,
    enforcedSlices: slices.filter((slice) => !unlayered.includes(slice)),
  }),
  sliceBoundaries([sourceFiles]),
  restricted([sourceFiles], patterns),
  restricted(
    pageObjects,
    patterns.filter((pattern) => pattern !== playwrightPattern)
  ),
  // A folder of testing/ named after a slice belongs to that slice, so it
  // may use the slice's own files (ADR-0057).
  ...slices.map((slice) =>
    restricted(
      [`testing/${slice}/**/*.{ts,tsx}`],
      [
        frontDoor(slices.filter((other) => other !== slice)),
        ...patterns.slice(1).filter((pattern) => pattern !== playwrightPattern),
      ]
    )
  ),
];
