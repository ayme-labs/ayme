import { readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const eslint = new ESLint({ cwd: packageRoot });

/** The lint messages for `code` as if it were the file at `path`. */
async function lint(path: string, code: string) {
  const [result] = await eslint.lintText(code, {
    filePath: join(packageRoot, path),
  });
  return result!.messages.map(({ message }) => message);
}

// ESLint loads the package config and its import resolver on first use.
it(
  "lint flags an import against the slice and layer layout",
  { timeout: 60_000 },
  async () => {
    expect(
      await lint(
        "src/pairing/domain/misplaced.ts",
        'export { listenOnFirstFreePort } from "../infrastructure/firstFreePort";\n'
      )
    ).toEqual([
      expect.stringContaining(
        "domain may only depend on the allowed horizontal layers"
      ),
    ]);
    expect(
      await lint(
        "src/client/misplaced.ts",
        'export { startMcpServer } from "../server";\n'
      )
    ).toEqual([expect.stringContaining("client may only use")]);
    expect(
      await lint(
        "src/tools/application/misplaced.ts",
        'export { AgentConnection } from "../../connection/application/agentConnection";\n'
      )
    ).toEqual([
      expect.stringContaining("Import another slice through its index.ts."),
    ]);
  }
);

it(
  "lint flags a type written as import() and a dynamic import against the layout",
  { timeout: 60_000 },
  async () => {
    const refusals: [path: string, code: string, message: string][] = [
      [
        "src/tools/application/misplaced.ts",
        'export type Connection = import("../../connection/application/agentConnection").AgentConnection;',
        "Import another slice through its index.ts.",
      ],
      [
        "src/server/misplaced.test.ts",
        'export type Connection = import("../connection/application/agentConnection").AgentConnection;',
        "Import another slice through its index.ts.",
      ],
      // Test support drives the built command: no import of src/ of any kind.
      [
        "testing/misplaced.ts",
        'export { startMcpServer } from "../src/server";',
        "The MCP package's test support uses no slice",
      ],
      [
        "testing/misplaced.ts",
        'export const load = () => import("../src/server");',
        "The MCP package's test support uses no slice",
      ],
      [
        "testing/misplaced.ts",
        'export type Start = typeof import("../src/server").startMcpServer;',
        "The MCP package's test support uses no slice",
      ],
      [
        "testing/fixtures/misplaced.ts",
        "export const load = () => import(`../../src/server/index`);",
        "The MCP package's test support uses no slice",
      ],
      // The module in backticks.
      [
        "src/tools/application/misplaced.ts",
        "export const load = () => import(`../../connection/application/agentConnection`);",
        "Import another slice through its index.ts.",
      ],
    ];
    for (const [path, code, message] of refusals)
      expect(await lint(path, `${code}\n`), `${path}: ${code}`).toEqual([
        expect.stringContaining(message),
      ]);
    // A folder of testing/ named src is test support's own.
    expect(
      await lint(
        "testing/placed.ts",
        'export const load = () => import("./src/fixture");\nexport { fixture } from "./src/fixture";\n'
      )
    ).toEqual([]);
  }
);

const layerRule = "horizontal-boundaries/dependencies";
type LayerPolicy = { from?: { element?: { types?: string } } };

/** Every slice under src/ that lint holds to the layer order, and the layer
 * folders it knows, read from the layer rule's options. */
async function layeredSlices() {
  const src = join(packageRoot, "src");
  const slices = readdirSync(src, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const layered: string[] = [];
  const layers = new Set<string>();
  for (const slice of slices) {
    const config = (await eslint.calculateConfigForFile(
      join(src, slice, "domain", "file.ts")
    )) as {
      rules?: Record<string, [unknown, { policies: LayerPolicy[] }?]>;
    };
    const options = config.rules?.[layerRule]?.[1];
    if (!options) continue;
    layered.push(slice);
    for (const policy of options.policies)
      if (policy.from?.element?.types) layers.add(policy.from.element.types);
  }
  return { layered, layers };
}

it(
  "every file of a layered slice but its index.ts sits in a layer folder",
  { timeout: 60_000 },
  async () => {
    const { layered, layers } = await layeredSlices();
    // The rule itself, so a lookup that finds nothing cannot pass.
    expect(layered).toContain("pairing");
    expect([...layers]).toContain("domain");
    const outside = layered.flatMap((slice) =>
      readdirSync(join(packageRoot, "src", slice), {
        recursive: true,
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile())
        .map((entry) =>
          relative(join(packageRoot, "src"), join(entry.parentPath, entry.name))
        )
        // A file at the slice's top is outside a layer folder, but for its
        // index.ts; a deeper one is in the folder its path starts with.
        .filter((path) => {
          const [, first, ...rest] = path.split(sep);
          return rest.length ? !layers.has(first!) : first !== "index.ts";
        })
    );
    expect(outside, "files outside a layer folder").toEqual([]);
  }
);

it(
  "every folder of src/ is a slice eslint.config.js lists",
  { timeout: 60_000 },
  async () => {
    const config = (await eslint.calculateConfigForFile(
      join(packageRoot, "src/cli.ts")
    )) as {
      rules?: Record<
        string,
        [
          unknown,
          {
            policies: { from: { element: { captured: { slice: string } } } }[];
          }?,
        ]
      >;
    };
    const listed = (
      config.rules?.["slice-boundaries/dependencies"]?.[1]?.policies ?? []
    ).map(({ from }) => from.element.captured.slice);
    // The rule itself, so a lookup that finds nothing cannot pass.
    expect(listed).toContain("server");
    const folders = readdirSync(join(packageRoot, "src"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(
      folders.filter((folder) => !listed.includes(folder)),
      "folders of src/ that are no slice: lint holds them to no slice's rules"
    ).toEqual([]);
  }
);
