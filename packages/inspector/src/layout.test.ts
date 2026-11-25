// @vitest-environment node

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
const slow = { timeout: 60_000 };

const frontDoor = "Import another slice through its index.ts.";
const aymeEntry = "Import ayme only through @ayme-dev/ayme/inspector.";
const quoted = "Write the module in import() as a quoted string";

// Each import the layout refuses: the file, its code and the message.
const refusals: [path: string, code: string, message: string][] = [
  [
    "src/runs/domain/misplaced.ts",
    'export type { LensId } from "../../navigation/domain/lens";',
    frontDoor,
  ],
  [
    "src/runs/domain/misplaced.ts",
    'export type Lens = import("../../navigation/domain/lens").LensId;',
    frontDoor,
  ],
  [
    "src/tools/misplaced.test.ts",
    'export type Lens = import("../navigation/domain/lens").LensId;',
    frontDoor,
  ],
  [
    "src/app/misplaced.ts",
    'import type { ToolInfo } from "@ayme-dev/ayme";\nexport type Misplaced = ToolInfo;',
    aymeEntry,
  ],
  [
    "src/runs/infrastructure/misplaced.ts",
    'export const load = () => import("@ayme-dev/ayme/internal");',
    aymeEntry,
  ],
  [
    "src/navigation/domain/misplaced.ts",
    'export type Misplaced = import("@ayme-dev/ayme").ToolInfo;',
    aymeEntry,
  ],
  [
    "src/misplaced.ts",
    'export const load = () => import("@ayme-dev/ayme");',
    aymeEntry,
  ],
  // A module in backticks, which the selectors cannot read, so it would
  // slip past them all: the slice order here.
  [
    "src/app/misplaced.ts",
    "export const load = () => import(`@ayme-dev/ayme/internal`);",
    quoted,
  ],
  [
    "src/shared/domain/misplaced.ts",
    "export const load = () => import(`../../panel/index`);",
    quoted,
  ],
  [
    "src/runs/domain/misplaced.test.ts",
    "export const load = () => import(`../../navigation/domain/lens`);",
    quoted,
  ],
];

it("lint flags an import against the slice layout", slow, async () => {
  for (const [path, code, message] of refusals)
    expect(await lint(path, `${code}\n`), `${path}: ${code}`).toEqual([
      expect.stringContaining(message),
    ]);
});

it(
  "lint lets production code use ayme's inspector entry, and tests and test support its public API",
  slow,
  async () => {
    const allowed: [path: string, code: string][] = [
      [
        "src/runs/domain/placed.ts",
        'export type Placed = import("@ayme-dev/ayme/inspector").InspectorState;',
      ],
      [
        "src/runs/infrastructure/placed.test.ts",
        'export const load = () => import("@ayme-dev/ayme/internal");',
      ],
      [
        "testing/pom/Placed.ts",
        'import { ayme } from "@ayme-dev/ayme";\nexport const Placed = ayme;',
      ],
    ];
    for (const [path, code] of allowed)
      expect(await lint(path, `${code}\n`), `${path}: ${code}`).toEqual([]);
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
  "every file of a layered slice but its front door sits in a layer folder",
  slow,
  async () => {
    const { layered, layers } = await layeredSlices();
    // The rule itself, so a lookup that finds nothing cannot pass.
    expect(layered).toContain("navigation");
    expect([...layers]).toContain("view");
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
        // front door; a deeper one is in the folder its path starts with.
        .filter((path) => {
          const [, first, ...rest] = path.split(sep);
          return rest.length ? !layers.has(first!) : first !== "index.ts";
        })
    );
    expect(outside, "files outside a layer folder").toEqual([]);
  }
);

it("every folder of src/ is a slice eslint.config.js lists", slow, async () => {
  const config = (await eslint.calculateConfigForFile(
    join(packageRoot, "src/index.ts")
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
  expect(listed).toContain("app");
  const folders = readdirSync(join(packageRoot, "src"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  expect(
    folders.filter((folder) => !listed.includes(folder)),
    "folders of src/ that are no slice: lint holds them to no slice's rules"
  ).toEqual([]);
});
