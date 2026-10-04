import config from "@ayme-dev/eslint-config/base";
import {
  boundariesPlugin,
  horizontalBoundaries,
} from "@ayme-dev/eslint-config/horizontal-boundaries";

// The source layout's rules. packages/inspector/AGENTS.md introduces them;
// this file is the source of truth.

const packageRoot = import.meta.dirname;

// The slices of src/, and the slices each may use: only those listed before
// it here. app composes them, and nothing uses app. testing is the Inspector
// POM entry, which only tests may use (ADR-0026).
const allowedSlices = {
  shared: [],
  panel: ["shared"],
  navigation: ["shared"],
  "page-model": ["navigation", "panel", "shared"],
  structure: ["page-model", "navigation", "panel", "shared"],
  runs: ["structure", "page-model", "navigation", "panel", "shared"],
  tools: ["runs", "structure", "page-model", "navigation", "panel", "shared"],
  demo: [
    "tools",
    "runs",
    "structure",
    "page-model",
    "navigation",
    "panel",
    "shared",
  ],
  app: [
    "demo",
    "tools",
    "runs",
    "structure",
    "page-model",
    "navigation",
    "panel",
    "shared",
  ],
  testing: ["shared"],
};
const slices = Object.keys(allowedSlices);
const sourceFiles = "src/**/*.{ts,tsx}";
const testFiles = ["src/**/*.test.{ts,tsx}"];

/** Imports beneath another slice, past its front door (its index.ts). */
function deepImport(slice, { tests }) {
  const others = slices.filter(
    (other) => other !== slice && !(tests && other === "testing")
  );
  // Tests may also use another slice's test-utils.
  const allowed = tests
    ? "index(\\.[jt]sx?)?$|test-utils/"
    : "index(\\.[jt]sx?)?$";
  return `(^|/)(${others.join("|")})/(?!${allowed})`;
}

function frontDoors(slice, files, { tests }) {
  const patterns = [
    {
      regex: deepImport(slice, { tests }),
      message: "Import another slice through its index.ts.",
    },
  ];
  if (!tests)
    patterns.push({
      regex: "(^|/)test-utils(/|$)",
      message: "Only tests may import test-utils.",
    });
  return {
    files,
    ...(tests ? {} : { ignores: testFiles }),
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

export default [
  ...config,
  ...horizontalBoundaries({
    packageRoot,
    // app and testing aren't layered.
    enforcedSlices: slices.filter(
      (slice) => !["app", "testing"].includes(slice)
    ),
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
                        target !== "testing" &&
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
  {
    files: [sourceFiles],
    // Infrastructure, and the instrumentation that mounts the Inspector.
    ignores: [
      "src/**/infrastructure/**",
      "src/app/mountInspector.ts",
      ...testFiles,
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: ["@ayme-dev/ayme", "@ayme-dev/ayme/internal"].map((name) => ({
            name,
            allowTypeImports: true,
            message:
              "Only infrastructure reads @ayme-dev/ayme at runtime; the rest takes props.",
          })),
        },
      ],
    },
  },
];
