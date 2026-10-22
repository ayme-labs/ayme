import config from "@ayme-dev/eslint-config/base";
import {
  boundariesPlugin,
  horizontalBoundaries,
} from "@ayme-dev/eslint-config/horizontal-boundaries";

// The source layout's rules. packages/ayme/AGENTS.md introduces them; this
// file is the source of truth.

const packageRoot = import.meta.dirname;

// The slices of src/, and the slices each may use: only those listed before
// it here. runtime is the composition root: only the entries use it.
const allowedSlices = {
  shared: [],
  "page-state": ["shared"],
  runs: ["page-state", "shared"],
  "page-objects": ["runs", "page-state", "shared"],
  tools: ["page-objects", "runs", "page-state", "shared"],
  "goal-loop": ["tools", "page-objects", "runs", "page-state", "shared"],
  runtime: [
    "goal-loop",
    "tools",
    "page-objects",
    "runs",
    "page-state",
    "shared",
  ],
};
const slices = Object.keys(allowedSlices);
const sourceFiles = "src/**/*.ts";
// Test code may use any slice, so a test stays beside the module it is
// about even when it starts a whole runtime.
const testCode = [
  "src/**/*.test.ts",
  "src/**/*.testSupport.ts",
  "src/test-utils/**",
];

/** Relative imports beneath another slice, past its front door (its index.ts). */
function deepImport(slice) {
  const others = slices.filter((other) => other !== slice);
  return `^\\.\\.?/(.*/)?(${others.join("|")})/(?!index(\\.[jt]s)?$)`;
}

/** Relative imports of test code: a test-utils folder or a test harness. */
const testCodeImport = String.raw`^\.\.?/(.*/)?(test-utils/.*|[^/]+\.testSupport)$`;

function frontDoors(slice, files, { tests }) {
  const patterns = [
    {
      regex: deepImport(slice),
      message: "Import another slice through its index.ts.",
    },
    ...(tests
      ? []
      : [
          {
            regex: testCodeImport,
            message: "Only test code may use test code.",
          },
        ]),
  ];
  return {
    files,
    ...(tests ? {} : { ignores: testCode }),
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
    // The other slices aren't layered yet; packages/ayme/AGENTS.md says why.
    enforcedSlices: ["runs", "goal-loop"],
  }),
  {
    files: [sourceFiles],
    ignores: testCode,
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
    frontDoors(slice, [`src/${slice}/**/*.ts`], { tests: false }),
    frontDoors(
      slice,
      [`src/${slice}/**/*.test.ts`, `src/${slice}/**/*.testSupport.ts`],
      { tests: true }
    ),
  ]),
  // The entries, the package's own tests and the shared test harnesses,
  // which use the slices' front doors.
  frontDoors(undefined, ["src/*.ts"], { tests: false }),
  frontDoors(undefined, ["src/*.test.ts", "src/test-utils/**/*.ts"], {
    tests: true,
  }),
];
