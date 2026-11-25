import config from "@ayme-dev/eslint-config/base";
import {
  boundariesPlugin,
  horizontalBoundaries,
} from "@ayme-dev/eslint-config/horizontal-boundaries";

// The source layout's rules; this file is the source of truth.
// packages/mcp/AGENTS.md holds the rules lint cannot see.

const packageRoot = import.meta.dirname;

// The slices of src/, and the slices each may use: only those listed before
// it here. server, client and process are the composition roots: nothing
// uses them, and none uses another. Test support lives in testing/ beside
// src/ (ADR-0057): it drives the built command from outside and uses no slice.
const allowedSlices = {
  // The messages between the server and the page client or App Process, as
  // zod schemas both sides validate.
  contract: [],
  // The connect link and token, the server's ports and their scan, the tab's
  // stored pairing, the ways the page learns one, and the version gap.
  pairing: ["contract"],
  // The server's paired page and App Processes, the tRPC channel on both
  // ends, and the behaviour types the composition roots run.
  connection: ["pairing", "contract"],
  // The external Inspector (ADR-0049): serving its build, relaying its
  // window's requests to the paired page, and what `ayme inspect` prints.
  inspector: ["connection", "pairing", "contract"],
  // The page's tools as MCP tools, the server's own tools, and the client's
  // and App Process's work with ayme.tools.
  tools: ["inspector", "connection", "pairing", "contract"],
  // The Page Objects `ayme mcp` serves (ADR-0051): finding, building and
  // serving the entry. Server side only.
  "served-page-objects": ["connection", "pairing", "contract"],
  // The composition root of `ayme mcp`, which src/cli.ts starts.
  server: [
    "served-page-objects",
    "tools",
    "inspector",
    "connection",
    "pairing",
    "contract",
  ],
  // The composition root of the ./client entry.
  client: ["tools", "inspector", "connection", "pairing", "contract"],
  // The composition root of the ./process entry, an App Process's side.
  process: ["tools", "connection", "pairing", "contract"],
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
    // contract and the composition roots aren't layered.
    enforcedSlices: [
      "pairing",
      "connection",
      "inspector",
      "tools",
      "served-page-objects",
    ],
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
  // Test support (ADR-0057) drives the built command from outside, so it
  // imports nothing of src/.
  {
    files: ["testing/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: String.raw`^\.\.?/(.*/)?src(/|$)`,
              message:
                "The MCP package's test support uses no slice: it drives the built ayme command.",
            },
          ],
        },
      ],
    },
  },
];
