import config from "@ayme-dev/eslint-config/base";
import {
  boundariesPlugin,
  horizontalBoundaries,
} from "@ayme-dev/eslint-config/horizontal-boundaries";

// The source layout's rules; this file is the source of truth.
// packages/inspector/AGENTS.md holds the rules lint cannot see.

const packageRoot = import.meta.dirname;

// The slices of src/, and the slices each may use: only those listed before it
// here. Every folder of src/ is a slice, which src/layout.test.ts checks. app
// composes them, and nothing uses app. Test support, the Inspector POM
// included, lives in testing/ beside src/ (ADR-0057).
const allowedSlices = {
  // The contract client and its two transports, rendering into the shadow
  // root, and shared UI bits.
  shared: [],
  // The dockable panel, its preferences and its body layout.
  panel: ["shared"],
  // The selection, the Lens contract, the run slot, the navigator and the
  // page highlights.
  navigation: ["shared"],
  // The Page Object tree and the Model lens.
  "page-model": ["navigation", "panel", "shared"],
  // The page state tree, member selection and the Structure lens.
  structure: ["page-model", "navigation", "panel", "shared"],
  // Running a tool, and the Runs of the page's Run log.
  runs: ["structure", "page-model", "navigation", "panel", "shared"],
  // The tool list, the run card and its fields, and ref picking.
  tools: ["runs", "structure", "page-model", "navigation", "panel", "shared"],
  // Mounting, in the page or filling the external build's window, the
  // stylesheet and the wiring of every slice.
  app: [
    "tools",
    "runs",
    "structure",
    "page-model",
    "navigation",
    "panel",
    "shared",
  ],
};
const slices = Object.keys(allowedSlices);
const sourceFiles = "src/**/*.{ts,tsx}";
const testFiles = ["src/**/*.test.{ts,tsx}"];
const testSupport = "testing/**/*.{ts,tsx}";

/** Imports beneath another slice, past its front door (its index.ts). A path
 * through testing/ is test support, which has no front door for the
 * package's own tests: its folders are named after the slices they serve. */
function deepImport(slice) {
  const others = slices.filter((other) => other !== slice);
  return `^(?!(.*/)?testing/).*(^|/)(${others.join("|")})/(?!index(\\.[jt]sx?)?$)`;
}

// The Inspector reads ayme only through its inspector entry (ADR-0049).
// Tests, and the test support beside src/, may use ayme's public API.
const aymeThroughInspector = {
  regex: "^@ayme-dev/ayme(/(?!inspector$).*)?$",
  message: "Import ayme only through @ayme-dev/ayme/inspector.",
};

function frontDoors(slice, files, { tests, ignores = [] }) {
  const patterns = [
    {
      regex: deepImport(slice),
      message: "Import another slice through its index.ts.",
    },
    ...(tests ? [] : [aymeThroughInspector]),
  ];
  return restrictedImports(
    files,
    patterns,
    tests ? ignores : [...testFiles, ...ignores]
  );
}

/** Refuses imports matching `patterns` in `files`: static, dynamic, and in a
 * type written as `import("…")`. A later block's patterns replace an earlier
 * one's for its files. */
function restrictedImports(files, patterns, ignores = []) {
  return {
    files,
    ...(ignores.length ? { ignores } : {}),
    rules: {
      "no-restricted-imports": ["error", { patterns }],
      // esquery reads `/` as the end of a regex, so selectors match it as
      // `\x2F`.
      "no-restricted-syntax": [
        "error",
        ...patterns.flatMap(({ regex, message }) => {
          const value = `/${regex.replaceAll("/", String.raw`\x2F`)}/`;
          return [
            `ImportExpression[source.value=${value}]`,
            `TSImportType[source.value=${value}]`,
          ].map((selector) => ({ selector, message }));
        }),
        // A module in backticks, which the selectors above do not read.
        {
          selector:
            'ImportExpression[source.type="TemplateLiteral"][source.expressions.length=0]',
          message:
            "Write the module in import() as a quoted string, so lint can check it.",
        },
      ],
    },
  };
}

export default [
  ...config,
  ...horizontalBoundaries({
    packageRoot,
    // app isn't layered.
    enforcedSlices: slices.filter((slice) => slice !== "app"),
  }),
  // Every production file under src/, in a slice or not; the blocks below
  // add their own patterns.
  restrictedImports([sourceFiles], [aymeThroughInspector], testFiles),
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
    },
  },
  ...slices.flatMap((slice) => [
    frontDoors(slice, [`src/${slice}/**/*.{ts,tsx}`], { tests: false }),
    frontDoors(slice, [`src/${slice}/**/*.test.{ts,tsx}`], { tests: true }),
  ]),
  // The package entry and its test, which use the slices' front doors.
  frontDoors(undefined, ["src/*.{ts,tsx}"], { tests: false }),
  frontDoors(undefined, ["src/*.test.{ts,tsx}"], { tests: true }),
  // Test support (ADR-0057): a folder of testing/ named after a slice belongs
  // to that slice, so it may use the slice's own files, and other slices
  // through their front doors. The rest of testing/ uses front doors only.
  ...slices.map((slice) =>
    frontDoors(slice, [`testing/${slice}/**/*.{ts,tsx}`], { tests: true })
  ),
  frontDoors(undefined, [testSupport], {
    tests: true,
    ignores: slices.map((slice) => `testing/${slice}/**`),
  }),
];
