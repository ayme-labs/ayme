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
  // The in-page module (ADR-0049). Only a slice's infrastructure and runtime
  // may use it, which the layered slices' block below enforces.
  "in-page": ["shared"],
  "page-state": ["in-page", "shared"],
  runs: ["page-state", "in-page", "shared"],
  "page-objects": ["runs", "page-state", "in-page", "shared"],
  tools: ["page-objects", "runs", "page-state", "in-page", "shared"],
  "goal-loop": [
    "tools",
    "page-objects",
    "runs",
    "page-state",
    "in-page",
    "shared",
  ],
  runtime: [
    "goal-loop",
    "tools",
    "page-objects",
    "runs",
    "page-state",
    "in-page",
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
// The in-page module's host part. Its page part runs in the document and
// is built
// into one self-contained install function; `host` drives it through
// Playwright's Page and touches no browser global.
const inPageHost = "src/in-page/host/**/*.ts";
// Host files that still read the document's slot through the browser's
// globals: each may, until the issue named with it is done.
// src/layout.test.ts fails when one no longer needs to.
const inPageHostGlobalsExceptions = [
  // The transitional lookup of an element by ref for the browser runtime.
  { file: "src/in-page/host/elementLookup.ts", issue: "#1182" },
  // The reach of the browser runtime, which measures the elements it holds
  // in the document's own realm until it reads the page through Locators.
  { file: "src/in-page/host/reachInRealm.ts", issue: "#1182" },
];
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

// Ayme's package name and its own build output reach the entries past every
// rule here, so no file under src/, tests included, imports either.
const ownPackage = [
  {
    regex: "^@ayme-dev/ayme(/.*)?$",
    message:
      "Ayme's source never imports Ayme by its package name: import the module by its path.",
  },
  {
    regex: String.raw`^\.\.?/(.*/)?dist(/.*)?$`,
    message:
      "Ayme's source never imports its own build output: import the module by its path in src/.",
  },
];

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
  return restrictedImports(files, patterns, [
    ...(tests ? [] : testCode),
    ...ignores,
  ]);
}

/**
 * Refuses imports matching `patterns` in `files`, for every kind of import.
 * A later block's patterns replace an earlier one's for its files, so each
 * block refuses ownPackage too.
 */
function restrictedImports(files, ownPatterns, ignored = []) {
  const patterns = [...ownPatterns, ...ownPackage];
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

// Playwright Lite's internal entry is browser-only and not Playwright's API,
// so no production file imports it (ADR-0049). These files still do: each
// may, until the issue named with it is done. src/layout.test.ts fails when
// one no longer imports it, so it leaves the list then.
const liteInternalExceptions = [
  { file: "src/internal.ts", issue: "#1182" },
  { file: "src/page-objects/infrastructure/litePageDriver.ts", issue: "#1175" },
  {
    file: "src/page-objects/infrastructure/pomRootObservation.ts",
    issue: "#1175",
  },
  { file: "src/tools/application/elementTools.ts", issue: "#1176" },
  { file: "src/tools/infrastructure/generateLocator.ts", issue: "#1176" },
  { file: "src/tools/infrastructure/pressKey.ts", issue: "#1176" },
];
const liteInternal = "@ayme-dev/playwright-lite/internal";
const liteInternalMessage = `No production file imports Playwright Lite's internal entry, ${liteInternal}: reach the page through Playwright's Page and Locator, or the in-page module (ADR-0049).`;
const allowlistedEntries = liteInternalExceptions
  .map(({ file }) => file)
  .filter((file) => /^src\/[^/]+\.ts$/.test(file));

/** Relative imports of the in-page module, which domain and application may not use. */
/** Packages the in-page module may use: core, and Playwright's types on its host side. */
const inPageDependencies = {
  regex:
    "^(?![./]|@ayme-dev/core(/.*)?$|@playwright/test$|virtual:ayme-(in-page|aria-snapshot)$)",
  message:
    "The in-page module uses only shared and @ayme-dev/core, and Playwright's types on its host side.",
};

const inPageImport = {
  regex: String.raw`^\.\.?/(.*/)?in-page(/.*)?$`,
  message:
    "Only a slice's infrastructure and runtime may use the in-page module.",
};

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
  // Playwright Lite's internal entry, refused in production code but for the
  // allowlist above. The last policy that matches decides.
  {
    files: [sourceFiles],
    ignores: testCode,
    plugins: { "lite-internal": boundariesPlugin },
    rules: {
      "lite-internal/dependencies": [
        "error",
        {
          default: "allow",
          checkAllOrigins: true,
          checkUnknownLocals: true,
          policies: [
            {
              disallow: { dependency: { source: liteInternal } },
              message: liteInternalMessage,
            },
            ...liteInternalExceptions.map(({ file }) => ({
              from: { file: { path: file } },
              allow: { dependency: { source: liteInternal } },
            })),
          ],
        },
      ],
    },
  },
  // Every file under src/, in a slice or not; the blocks below add their own.
  restrictedImports([sourceFiles], []),
  ...slices.flatMap((slice) => [
    frontDoors(slice, [`src/${slice}/**/*.ts`], {
      tests: false,
      restricted: slice === "in-page" ? [inPageDependencies] : [],
    }),
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
          inPageImport,
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
    restricted: [inPageImport],
  }),
  // The in-page module's host side is DOM-free: only its page part, which
  // runs in the document, may use the browser's globals.
  {
    files: [inPageHost],
    ignores: [
      ...testCode,
      ...inPageHostGlobalsExceptions.map(({ file }) => file),
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        ...browserGlobals.map((name) => ({
          name,
          message:
            "Only the in-page module's page part may use the browser's globals.",
        })),
      ],
    },
  },
  // The entries, the package's own tests and the shared test harnesses,
  // which use the slices' front doors. The entries belong to no slice, which
  // the rule against Playwright Lite's internal entry above reads, so they
  // refuse it here, but for the allowlisted ones.
  frontDoors(undefined, ["src/*.ts"], {
    tests: false,
    ignores: allowlistedEntries,
    restricted: [
      {
        regex: `^${liteInternal}$`,
        message: liteInternalMessage,
      },
    ],
  }),
  frontDoors(undefined, allowlistedEntries, { tests: false }),
  frontDoors(undefined, ["src/*.test.ts", "src/test-utils/**/*.ts"], {
    tests: true,
  }),
];
