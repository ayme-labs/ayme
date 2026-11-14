import config from "@ayme-dev/eslint-config/base";
import {
  boundariesPlugin,
  horizontalBoundaries,
} from "@ayme-dev/eslint-config/horizontal-boundaries";

// The source layout's rules. packages/recorder/AGENTS.md introduces them;
// this file is the source of truth.

const packageRoot = import.meta.dirname;

// The slices of src/, and the slices each may use: only those listed before
// it here. engine is the composition root and the front door. testing is the
// `./testing` entry, which only tests may use (ADR-0026).
const allowedSlices = {
  contract: [],
  timeline: ["contract"],
  session: ["timeline", "contract"],
  playwright: ["session", "timeline", "contract"],
  server: ["session", "timeline", "contract"],
  engine: ["server", "playwright", "session", "timeline", "contract"],
  testing: ["engine", "session", "timeline", "contract"],
};
const slices = Object.keys(allowedSlices);
// contract, engine and testing aren't layered.
const layeredSlices = ["timeline", "session", "playwright", "server"];
const sourceFiles = "src/**/*.ts";
const testFiles = ["src/**/*.test.ts"];

// ADR-0046: the layer order holds across slices. A layered slice has no
// front door of its own: each of its layers that other code uses has one, an
// index.ts inside that layer's folder, so the layer rule judges an import
// through it by the layer it sits in. An unlayered slice's front door is its
// own index.ts.
const layers = ["domain", "application", "infrastructure"];
const index = String.raw`index(\.[jt]s)?`;

/** Relative imports beneath another slice, past its front doors. Only
 * relative paths: a package such as `playwright-core/...` is no slice. */
function frontDoors(slice) {
  const others = (list) => list.filter((other) => other !== slice).join("|");
  const unlayered = others(slices.filter((s) => !layeredSlices.includes(s)));
  const layered = others(layeredSlices);
  return [
    {
      regex: [
        String.raw`^\.\.?/(.*/)?(${unlayered})/(?!${index}$)`,
        String.raw`^\.\.?/(.*/)?(${layered})/(?!(${layers.join("|")})(/${index})?$|${index}$)`,
      ].join("|"),
      message:
        "Import another slice through its front door: the index.ts of the layer you use in a layered slice, such as ../session/domain, or else the slice's index.ts.",
    },
    {
      // Another slice's: inside a slice, a module may be named as a slice is.
      regex: String.raw`^\.\.?/(.*/)?(${layered})(/${index})?$`,
      message:
        "A layered slice has no index.ts: import the front door of the layer you use, such as ../session/domain.",
    },
  ];
}
// Types included: no Playwright type leaves the slice either (ADR-0052).
const playwright = {
  regex: "^(@playwright/|playwright(-core)?(/|$))",
  message:
    "Only the playwright slice imports Playwright (docs/adr/0052-the-recorder-runs-on-stock-playwright-and-uses-its-private-parts-only-under-test.md).",
};
const anyEffect = {
  regex: "^(@effect/|effect(/|$))",
  message:
    "No Effect here: it stays in the flows and adapters, out of the pure rules, the contract and the front door.",
};
const otherEffectPackages = {
  regex: "^(@effect/|effect/unstable(/|$))",
  message:
    "Production code uses only the stable effect package: no @effect/* package and no effect/unstable module.",
};

// How the playwright slice's infrastructure is measured decides where its
// code may sit (docs/testing.md#code-a-real-browser-runs): `live/` drives a
// real browser and `in-page/` runs in the page, while the plain logic beside
// them stays testable without a browser. So plain logic reaches neither, the
// layer's front door reaches `live/` to wire the stock adapter, and
// `in-page/` is reached from `live/` only and imports nothing to run.
const infrastructure = "src/playwright/infrastructure";
const noLiveOrInPage = {
  regex: String.raw`^\./(live|in-page)(/|$)`,
  message:
    "Plain logic stays testable without a browser: it may not import infrastructure/live or infrastructure/in-page (docs/testing.md#code-a-real-browser-runs).",
};
const noInPage = {
  regex: String.raw`^\./in-page(/|$)`,
  message:
    "infrastructure/in-page is reached from infrastructure/live only (docs/testing.md#code-a-real-browser-runs).",
};

/** One config per group of files: a later `no-restricted-imports` replaces an
 * earlier one for the same file, so each group states all of its patterns. */
function restrictedImports(files, patterns, { ignores } = {}) {
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

/** What the files of one slice (or, without one, of src/ itself) may not
 * import. Tests may use any Effect package; the testing slice is test-only
 * code, so it may too. */
function sliceRestrictions(slice) {
  const folder = slice ? `src/${slice}` : "src";
  const depth = slice ? "**/" : "";
  const always = [
    ...frontDoors(slice),
    ...(slice === "playwright" ? [] : [playwright]),
  ];
  // Effect-free: the contract, the timeline's pure rules and the package's
  // front door (src/index.ts); and every slice's domain layer.
  const effectFree = [undefined, "contract", "timeline"].includes(slice);
  const production =
    slice === "testing"
      ? always
      : [...always, effectFree ? anyEffect : otherEffectPackages];
  return [
    restrictedImports([`${folder}/${depth}*.ts`], production, {
      ignores: testFiles,
    }),
    ...(slice === "playwright"
      ? [
          restrictedImports(
            [`${infrastructure}/*.ts`],
            [...production, noLiveOrInPage],
            { ignores: [...testFiles, `${infrastructure}/index.ts`] }
          ),
          restrictedImports(
            [`${infrastructure}/index.ts`],
            [...production, noInPage]
          ),
        ]
      : []),
    ...(slice && !effectFree && slice !== "testing"
      ? [
          restrictedImports(
            [`${folder}/domain/**/*.ts`],
            [...always, anyEffect],
            { ignores: testFiles }
          ),
        ]
      : []),
    restrictedImports([`${folder}/${depth}*.test.ts`], always),
    ...(slice === "playwright"
      ? [
          restrictedImports(
            [`${infrastructure}/*.test.ts`],
            [...always, noLiveOrInPage]
          ),
        ]
      : []),
  ];
}

export default [
  ...config,
  ...horizontalBoundaries({ packageRoot, enforcedSlices: layeredSlices }),
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
  ...slices.flatMap(sliceRestrictions),
  {
    // What runs in the page is sent as text: it can use nothing it imports.
    // A type is all it may take, and its functions stay trivial: a decision
    // belongs in a plain rule (pageRules.ts), which Node tests and mutates.
    files: [`${infrastructure}/in-page/**/*.ts`],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: ".*",
              allowTypeImports: true,
              message:
                "Code in infrastructure/in-page runs in the page and may import types only (docs/testing.md#code-a-real-browser-runs).",
            },
          ],
        },
      ],
      complexity: ["error", 4],
    },
  },
  // The package's entry and its tests, which use the slices' front doors.
  ...sliceRestrictions(undefined),
];
