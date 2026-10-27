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
// shared and runtime stay unlayered, as packages/ayme/AGENTS.md says.
const layeredSlices = [
  "page-state",
  "runs",
  "page-objects",
  "goal-loop",
  "tools",
];
// The globals that reach the browser, or another copy of the bundle.
const browserGlobals = [
  "document",
  "window",
  "globalThis",
  "location",
  "history",
  "navigator",
  "self",
  "localStorage",
  "sessionStorage",
];
const sourceFiles = "src/**/*.ts";
// Test code may use any slice, so a test stays beside the module it is
// about even when it starts a whole runtime.
const testCode = [
  "src/**/*.test.ts",
  "src/**/*.testSupport.ts",
  "src/**/test-utils/**",
];

// A layered slice has a front door, an index.ts, in each layer folder that
// other code uses, so the layer rule judges an import through it by its
// layer. An unlayered slice's front door is its own index.ts.
const layers = ["domain", "application", "infrastructure"];
const index = String.raw`index(\.[jt]s)?`;

/** Relative imports beneath another slice, past its front doors. */
function deepImport(slice) {
  const others = (list) => list.filter((other) => other !== slice).join("|");
  const unlayered = others(slices.filter((s) => !layeredSlices.includes(s)));
  const layered = others(layeredSlices);
  return [
    String.raw`^\.\.?/(.*/)?(${unlayered})/(?!${index}$)`,
    String.raw`^\.\.?/(.*/)?(${layered})/(?!(${layers.join("|")})(/${index})?$|${index}$)`,
  ].join("|");
}

/** Relative imports of a layered slice's own index.ts, which it does not have. */
const layeredSliceIndex = String.raw`^\.\.?/(.*/)?(${layeredSlices.join("|")})(/${index})?$`;

/** Relative imports of test code: a test-utils folder, a test or a harness. */
const testCodeImport = String.raw`^\.\.?/(.*/)?(test-utils(/.*)?|[^/]+\.(test|testSupport)(\.[jt]s)?)$`;

/** esquery reads `/` as the end of a regex, so selectors match it as `\x2F`. */
function selectorRegex(regex) {
  return `/${regex.replaceAll("/", String.raw`\x2F`)}/`;
}

function frontDoors(slice, files, { tests, ignores = [], restricted = [] }) {
  const patterns = [
    {
      regex: deepImport(slice),
      message:
        "Import another slice through its front door: the index.ts of the layer you use in a layered slice, such as ../page-state/domain, or else the slice's index.ts.",
    },
    {
      regex: layeredSliceIndex,
      message:
        "A layered slice has no index.ts: import the front door of the layer you use, such as ../page-state/domain.",
    },
    ...(tests
      ? []
      : [
          {
            regex: testCodeImport,
            message: "Only test code may use test code.",
          },
        ]),
    ...restricted,
  ];
  const ignored = [...(tests ? [] : testCode), ...ignores];
  return {
    files,
    ...(ignored.length ? { ignores: ignored } : {}),
    rules: {
      "no-restricted-imports": ["error", { patterns }],
      // The same rules for import() as a value and as a type.
      "no-restricted-syntax": [
        "error",
        ...patterns.flatMap(({ regex, message }) => [
          {
            selector: `ImportExpression[source.value=${selectorRegex(regex)}]`,
            message,
          },
          {
            selector: `TSImportType[source.value=${selectorRegex(regex)}]`,
            message,
          },
        ]),
        {
          selector: "ImportExpression[source.type!=Literal]",
          message:
            "Name the module in import() with a string literal, so lint can check it.",
        },
      ],
    },
  };
}

// The layer order holds across slices as inside one, so a layer reaches
// another slice only through the front doors of the layers it may use. These
// files still break it: each may use one layer's front door, until the issues
// named with it are done. src/layout.test.ts fails when one no longer needs
// to, so it leaves the list then. New code that needs an exception before its
// issue is done adds one naming that issue. A "follow-up" has no issue yet.
const layerOrderExceptions = [
  {
    file: "src/page-objects/application/pomRegistry.ts",
    door: "page-state/infrastructure",
    issues: [
      "follow-up: reach checks read the per-document Page State store",
      "follow-up: providePageObjectStructure",
    ],
  },
  {
    file: "src/tools/application/browserTools.ts",
    door: "page-state/infrastructure",
    issues: ["follow-up: reach checks read the per-document Page State store"],
  },
  {
    file: "src/tools/application/elementTools.ts",
    door: "page-state/infrastructure",
    issues: ["follow-up: reach checks read the per-document Page State store"],
  },
  {
    file: "src/tools/application/historyTools.ts",
    door: "page-state/infrastructure",
    issues: ["follow-up: startNavigation"],
  },
  {
    file: "src/tools/application/navigateTool.ts",
    door: "page-state/infrastructure",
    issues: ["follow-up: startNavigation"],
  },
  {
    file: "src/tools/application/pageContext.ts",
    door: "page-state/infrastructure",
    issues: ["follow-up: page context reads a document's Page State Session"],
  },
  {
    file: "src/tools/application/pageContext.ts",
    door: "page-objects/infrastructure",
    issues: ["follow-up: Page Object registry reads"],
  },
  {
    file: "src/goal-loop/application/goalLoop.ts",
    door: "page-objects/infrastructure",
    issues: ["follow-up: Page Object registry reads"],
  },
  {
    file: "src/goal-loop/application/toolOptions.ts",
    door: "page-objects/infrastructure",
    issues: ["follow-up: Page Object registry reads"],
  },
  {
    file: "src/goal-loop/application/toolOptions.ts",
    door: "tools/infrastructure",
    issues: ["follow-up: Custom Tool and router store reads"],
  },
  {
    file: "src/goal-loop/domain/goalLoopOperations.ts",
    door: "page-state/application",
    issues: ["follow-up: goal-loop domain uses other slices' application"],
  },
  {
    file: "src/goal-loop/domain/goalLoopOperations.ts",
    door: "runs/application",
    issues: ["follow-up: goal-loop domain uses other slices' application"],
  },
  {
    file: "src/goal-loop/domain/goalLoopOperations.ts",
    door: "page-objects/application",
    issues: ["follow-up: goal-loop domain uses other slices' application"],
  },
  {
    file: "src/goal-loop/domain/goalLoopOperations.ts",
    door: "tools/application",
    issues: ["follow-up: goal-loop domain uses other slices' application"],
  },
  {
    file: "src/goal-loop/domain/goalLoopQuestions.ts",
    door: "page-objects/application",
    issues: ["follow-up: goal-loop domain uses other slices' application"],
  },
  {
    file: "src/goal-loop/domain/goalLoopQuestions.ts",
    door: "tools/application",
    issues: ["follow-up: goal-loop domain uses other slices' application"],
  },
];

export default [
  ...config,
  ...horizontalBoundaries({
    packageRoot,
    enforcedSlices: layeredSlices,
    exceptions: layerOrderExceptions.map(({ file, door }) => ({
      from: file,
      to: `src/${door}/index.ts`,
    })),
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
          // The entries belong to no element, and a file of an unlayered
          // slice shares its element with the slice's index.ts.
          checkUnknownLocals: true,
          checkInternals: true,
          policies: slices.flatMap((slice) => [
            {
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
            },
            {
              from: { element: { captured: { slice } } },
              disallow: { to: { file: { path: "src/*.ts" } } },
              message: "A slice may not use the package's entries.",
            },
            {
              from: { element: { captured: { slice } } },
              disallow: {
                to: {
                  file: {
                    path: layeredSlices.includes(slice)
                      ? layers.map((layer) => `src/${slice}/${layer}/index.ts`)
                      : `src/${slice}/index.ts`,
                  },
                },
              },
              message:
                "Inside a slice, import the module itself, not the slice's front doors.",
            },
          ]),
        },
      ],
    },
  },
  ...slices.flatMap((slice) => [
    frontDoors(slice, [`src/${slice}/**/*.ts`], { tests: false }),
    frontDoors(
      slice,
      [
        `src/${slice}/**/*.test.ts`,
        `src/${slice}/**/*.testSupport.ts`,
        `src/${slice}/**/test-utils/**/*.ts`,
      ],
      { tests: true }
    ),
  ]),
  // A layered slice reaches the browser through its infrastructure: its
  // domain and application act on the page and Document their Run hands
  // them. A later block replaces the rule config above for its files, so it
  // repeats the slice's front doors.
  ...layeredSlices.map((slice) => {
    const block = frontDoors(
      slice,
      [`src/${slice}/domain/**/*.ts`, `src/${slice}/application/**/*.ts`],
      {
        tests: false,
        restricted: [
          {
            regex: "^@ayme-dev/playwright-lite(/.*)?$",
            message: "Only a slice's infrastructure may use Playwright Lite.",
          },
        ],
      }
    );
    block.rules["no-restricted-globals"] = [
      "error",
      ...browserGlobals.map((name) => ({
        name,
        message: "Only a slice's infrastructure may use the browser's globals.",
      })),
    ];
    return block;
  }),
  // elementTools.ts resolves a selector target with Playwright Lite until
  // page-state does (#943).
  frontDoors("tools", ["src/tools/application/elementTools.ts"], {
    tests: false,
  }),
  // The entries, the package's own tests and the shared test harnesses,
  // which use the slices' front doors.
  frontDoors(undefined, ["src/*.ts"], { tests: false }),
  frontDoors(undefined, ["src/*.test.ts", "src/test-utils/**/*.ts"], {
    tests: true,
  }),
];
