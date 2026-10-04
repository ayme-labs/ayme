import { resolve } from "node:path";
import boundariesPlugin from "eslint-plugin-boundaries";

export { boundariesPlugin };

// The layers inside a slice, `src/<slice>/<layer>/`, and what each may use.
// A slice has only the layers it needs.
export const horizontalLayerElementTypes = [
  "domain",
  "application",
  "infrastructure",
  "presentation",
  "view",
  "test-utils",
];
const allowedLayerDependencies = {
  domain: ["domain"],
  application: ["application", "domain"],
  infrastructure: ["infrastructure", "application", "domain"],
  presentation: ["presentation", "view", "application", "domain"],
  view: ["view", "domain"],
  "test-utils": horizontalLayerElementTypes,
};

const sourceExtensions = "{js,mjs,cjs,ts,tsx}";
const testFilePattern = `**/*.{test,spec}.${sourceExtensions}`;

// Every file under `src/<slice>/` captures its slice as `slice`, inside a
// layer or not, so a package can add slice policies on the same elements.
function layerElements(sourceRoot) {
  return [
    ...horizontalLayerElementTypes.map((type) => ({
      type,
      pattern: `${sourceRoot}/*/${type}`,
      capture: ["slice"],
      partialMatch: false,
    })),
    {
      type: "slice",
      pattern: `${sourceRoot}/*`,
      capture: ["slice"],
      partialMatch: false,
    },
  ];
}

function layerPolicies() {
  return horizontalLayerElementTypes.map((sourceType) => ({
    from: { element: { types: sourceType } },
    disallow: {
      to: {
        element: {
          types: {
            anyOf: horizontalLayerElementTypes.filter(
              (targetType) =>
                !allowedLayerDependencies[sourceType].includes(targetType)
            ),
          },
        },
      },
    },
    message: `${sourceType} may only depend on the allowed horizontal layers.`,
  }));
}

/**
 * Horizontal layer boundaries for `src/<slice>/<layer>` packages. Every
 * source file is classified, tests included; the rule applies to the
 * enrolled slices' production files. Test files may use any layer.
 *
 * A package that adds its own boundaries rules must not set
 * `boundaries/elements` again: a later setting replaces this one and turns
 * the layer rule off. Select slices by `captured: { slice }` instead.
 *
 * @param {{ packageRoot: string; sourceRoot?: string; enforcedSlices: readonly string[] }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function horizontalBoundaries({
  packageRoot,
  sourceRoot = "src",
  enforcedSlices,
}) {
  if (!enforcedSlices?.length)
    throw new Error(
      "horizontalBoundaries requires at least one enforced slice."
    );
  if (enforcedSlices.some((slice) => !/^[a-z0-9-]+$/.test(slice)))
    throw new Error(
      "horizontalBoundaries slice names must be literal top-level directory names."
    );

  return [
    {
      files: [`${sourceRoot}/**/*.${sourceExtensions}`],
      settings: {
        "boundaries/root-path": packageRoot,
        "boundaries/elements": layerElements(sourceRoot),
        "import/resolver": {
          typescript: { project: resolve(packageRoot, "tsconfig.json") },
        },
      },
    },
    {
      files: enforcedSlices.map(
        (slice) => `${sourceRoot}/${slice}/**/*.${sourceExtensions}`
      ),
      ignores: [testFilePattern],
      plugins: {
        // An alias, so a package's own boundaries rules stay independent.
        "horizontal-boundaries": boundariesPlugin,
      },
      rules: {
        "horizontal-boundaries/dependencies": [
          "error",
          {
            default: "allow",
            checkAllOrigins: false,
            checkUnknownLocals: false,
            policies: layerPolicies(),
          },
        ],
      },
    },
  ];
}
