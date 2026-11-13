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

/** Relative imports beneath another slice, past its front door (its index.ts).
 * Only relative paths: a package such as `playwright-core/...` is no slice. */
const frontDoor = (slice) => ({
  regex: `^\\.\\.?/(.*/)?(${slices.filter((other) => other !== slice).join("|")})/(?!index(\\.[jt]s)?$)`,
  message: "Import another slice through its index.ts.",
});
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
    frontDoor(slice),
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
  // The package's entry and its tests, which use the slices' front doors.
  ...sliceRestrictions(undefined),
];
