import config from "@ayme-dev/eslint-config/base";
import {
  boundariesPlugin,
  horizontalBoundaries,
} from "@ayme-dev/eslint-config/horizontal-boundaries";

// The source layout's rules. packages/mcp/AGENTS.md introduces them; this
// file is the source of truth.

const packageRoot = import.meta.dirname;

// The slices of src/, and the slices each may use: only those listed before
// it here. server and client are the two composition roots: nothing uses
// them, and neither uses the other. testing is the `./testing` entry, which
// drives the built command from outside and uses no slice.
const allowedSlices = {
  contract: [],
  pairing: ["contract"],
  connection: ["pairing", "contract"],
  tools: ["connection", "pairing", "contract"],
  server: ["tools", "connection", "pairing", "contract"],
  client: ["tools", "connection", "pairing", "contract"],
  testing: [],
};
const slices = Object.keys(allowedSlices);
const sourceFiles = "src/**/*.ts";
const testFiles = ["src/**/*.test.ts"];

/** Relative imports beneath another slice, past its front door (its index.ts).
 * Only relative paths: a package such as `@trpc/server/...` is no slice. */
function deepImport(slice) {
  const others = slices.filter((other) => other !== slice);
  return `^\\.\\.?/(.*/)?(${others.join("|")})/(?!index(\\.[jt]s)?$)`;
}

function frontDoors(slice, files, { tests }) {
  const patterns = [
    {
      regex: deepImport(slice),
      message: "Import another slice through its index.ts.",
    },
  ];
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
    // contract, the composition roots and testing aren't layered.
    enforcedSlices: ["pairing", "connection", "tools"],
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
    frontDoors(slice, [`src/${slice}/**/*.test.ts`], { tests: true }),
  ]),
  // The command's entry and the package's tests, which use the slices'
  // front doors.
  frontDoors(undefined, ["src/*.ts"], { tests: false }),
  frontDoors(undefined, ["src/*.test.ts"], { tests: true }),
];
