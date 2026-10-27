import { dirname, join } from "node:path";
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

// Each import the layout refuses: the file, its code and the message.
const refusals: [path: string, code: string, message: string][] = [
  [
    "src/goal-loop/domain/misplaced.ts",
    'export { configureGoalLoop } from "../application/goalLoop";',
    "domain may only depend on the allowed horizontal layers",
  ],
  [
    "src/goal-loop/domain/misplaced.ts",
    'export type Loop = import("../application/goalLoop").GoalLoop;',
    "domain may only depend on the allowed horizontal layers",
  ],
  [
    "src/tools/application/misplaced.ts",
    'export { listPublishedBrowserTools } from "../infrastructure/publishedBrowserTools";',
    "application may only depend on the allowed horizontal layers",
  ],
  [
    "src/tools/application/misplaced.ts",
    'export { generateLocator } from "@ayme-dev/playwright-lite/internal";',
    "Only a slice's infrastructure may use Playwright Lite.",
  ],
  [
    "src/tools/domain/misplaced.ts",
    'export type Lite = import("@ayme-dev/playwright-lite").Page;',
    "Only a slice's infrastructure may use Playwright Lite.",
  ],
  [
    "src/page-objects/application/misplaced.ts",
    'export { createPage } from "@ayme-dev/playwright-lite";',
    "Only a slice's infrastructure may use Playwright Lite.",
  ],
  [
    "src/goal-loop/application/misplaced.ts",
    "export const title = () => document.title;",
    "Only a slice's infrastructure may use the browser's globals.",
  ],
  [
    "src/page-state/domain/misplaced.ts",
    "export const width = () => window.innerWidth;",
    "Only a slice's infrastructure may use the browser's globals.",
  ],
  [
    "src/runs/application/misplaced.ts",
    "export const store = globalThis as object;",
    "Only a slice's infrastructure may use the browser's globals.",
  ],
  [
    "src/page-objects/domain/misplaced.ts",
    "export const href = () => location.href;",
    "Only a slice's infrastructure may use the browser's globals.",
  ],
  [
    "src/tools/application/misplaced.ts",
    "export const back = () => history.back();",
    "Only a slice's infrastructure may use the browser's globals.",
  ],
  [
    "src/tools/domain/misplaced.ts",
    "export const agent = () => navigator.userAgent;",
    "Only a slice's infrastructure may use the browser's globals.",
  ],
  [
    "src/goal-loop/domain/misplaced.ts",
    "export const title = () => self.document.title;",
    "Only a slice's infrastructure may use the browser's globals.",
  ],
  [
    "src/runs/domain/misplaced.ts",
    'export const saved = () => localStorage.getItem("run");',
    "Only a slice's infrastructure may use the browser's globals.",
  ],
  [
    "src/tools/application/elementTools.ts",
    "export const title = () => document.title;",
    "Only a slice's infrastructure may use the browser's globals.",
  ],
  [
    "src/tools/application/misplaced.ts",
    'export { createRunQueue } from "../../runs/application/run";',
    "Import another slice through its front door",
  ],
  [
    "src/goal-loop/infrastructure/misplaced.ts",
    'export { buildToolOptions } from "../application";',
    "Inside a slice, import the module itself, not the slice's front doors.",
  ],
  [
    "src/page-objects/application/misplaced.ts",
    'export { litePageDriver } from "../infrastructure/litePageDriver";',
    "application may only depend on the allowed horizontal layers",
  ],
  [
    "src/page-state/misplaced.ts",
    'export { createPage } from "../page-objects/infrastructure";',
    "page-state may only use shared",
  ],
  [
    "src/page-state/misplaced.ts",
    'export type { ToolRunOptions } from "../runs/application";',
    "page-state may only use shared",
  ],
  [
    "src/page-state/misplaced.ts",
    'export type Runtime = import("../runtime").Ayme;',
    "page-state may only use shared",
  ],
  [
    "src/page-state/domain/misplaced.ts",
    'export { PageStateSession } from "../application/pageStateSession";',
    "domain may only depend on the allowed horizontal layers",
  ],
  [
    "src/page-state/application/misplaced.ts",
    'export { capturePage } from "../infrastructure/pageCapture";',
    "application may only depend on the allowed horizontal layers",
  ],
  [
    "src/shared/misplaced.ts",
    'export { createAyme } from "../index";',
    "A slice may not use the package's entries.",
  ],
  [
    "src/shared/misplaced.ts",
    "export const load = () => import(`../runtime`);",
    "Name the module in import() with a string literal",
  ],
  [
    "src/tools/misplaced.ts",
    'export { createRunQueue } from "../runs/application/run";',
    "Import another slice through its front door",
  ],
  [
    "src/tools/misplaced.ts",
    'export type Context = import("../runs/application/run").RunContext;',
    "Import another slice through its front door",
  ],
  [
    "src/tools/misplaced.test.ts",
    'export type Context = import("../runs/application/run").RunContext;',
    "Import another slice through its front door",
  ],
  [
    "src/tools/misplaced.test.ts",
    'export const load = () => vi.importActual<typeof import("../runs/application/run")>("../runs");',
    "Import another slice through its front door",
  ],
  [
    "src/tools/misplaced.test.ts",
    "export const load = () => import(`../runs/application/run`);",
    "Name the module in import() with a string literal",
  ],
  [
    "src/tools/misplaced.ts",
    'export { startSession } from "../test-utils/session.testSupport";',
    "Only test code may use test code.",
  ],
  [
    "src/tools/misplaced.ts",
    'export { startSession } from "../test-utils/session.testSupport.js";',
    "Only test code may use test code.",
  ],
  [
    "src/tools/misplaced.ts",
    'import "./toolTypes.test";',
    "Only test code may use test code.",
  ],
  // The layer order across slices, through each layer's front door.
  [
    "src/goal-loop/domain/misplaced.ts",
    'export { acceptedRefNodes } from "../../tools/application";',
    "domain may only depend on the allowed horizontal layers",
  ],
  [
    "src/goal-loop/domain/misplaced.ts",
    'export type Rooted = import("../../page-objects/application").RootedToolInstance;',
    "domain may only depend on the allowed horizontal layers",
  ],
  [
    "src/tools/domain/misplaced.ts",
    'export type { RunContext } from "../../runs/application";',
    "domain may only depend on the allowed horizontal layers",
  ],
  [
    "src/goal-loop/application/misplaced.ts",
    'export { listRegisteredPoms } from "../../page-objects/infrastructure";',
    "application may only depend on the allowed horizontal layers",
  ],
  [
    "src/tools/application/misplaced.ts",
    'export const load = () => import("../../page-state/infrastructure");',
    "application may only depend on the allowed horizontal layers",
  ],
  // An exception lets its file use its door, and no other.
  [
    "src/goal-loop/domain/goalLoopQuestions.ts",
    'export { configureCustomTools } from "../../tools/infrastructure";',
    "domain may only depend on the allowed horizontal layers",
  ],
  [
    "src/tools/misplaced.ts",
    'export { createRunQueue } from "../runs";',
    "A layered slice has no index.ts",
  ],
  [
    "src/tools/misplaced.ts",
    'export { createRunQueue } from "../runs/index";',
    "A layered slice has no index.ts",
  ],
  [
    "src/misplaced.ts",
    'export { createPage } from "./page-objects";',
    "A layered slice has no index.ts",
  ],
  [
    "src/runtime/misplaced.test.ts",
    'export type Context = import("../runs").RunContext;',
    "A layered slice has no index.ts",
  ],
  [
    "src/goal-loop/application/misplaced.ts",
    'export { planArguments } from "../domain/index";',
    "Inside a slice, import the module itself, not the slice's front doors.",
  ],
];

// ESLint loads the package config and its import resolver on first use.
it(
  "lint flags an import against the slice and layer layout",
  { timeout: 60_000 },
  async () => {
    for (const [path, code, message] of refusals)
      expect(await lint(path, `${code}\n`), `${path}: ${code}`).toEqual([
        expect.stringContaining(message),
      ]);
  }
);

it(
  "lint lets test code use any slice, through its index.ts",
  { timeout: 60_000 },
  async () => {
    expect(
      await lint(
        "src/page-state/misplaced.test.ts",
        'export { createAyme } from "../runtime";\n'
      )
    ).toEqual([]);
    expect(
      await lint(
        "src/goal-loop/test-utils/misplaced.ts",
        'export { createAyme } from "../../runtime";\n'
      )
    ).toEqual([]);
  }
);

it(
  "lint lets a slice's infrastructure and tests use the browser, and domain and application name its types",
  { timeout: 60_000 },
  async () => {
    const allowed: [path: string, code: string][] = [
      [
        "src/tools/infrastructure/misplaced.ts",
        'export { createPage } from "@ayme-dev/playwright-lite";\nexport const title = () => document.title;',
      ],
      [
        "src/goal-loop/application/misplaced.test.ts",
        "export const title = () => document.title;",
      ],
      ["src/page-state/domain/misplaced.ts", "export type Target = Element;"],
      // Until page-state resolves a selector target (#943).
      [
        "src/tools/application/elementTools.ts",
        'export { resolveLocatorElements } from "@ayme-dev/playwright-lite/internal";',
      ],
      [
        "src/runs/application/misplaced.ts",
        "export const last = (history: string[]) => history.at(-1);",
      ],
    ];
    for (const [path, code] of allowed)
      expect(await lint(path, `${code}\n`), `${path}: ${code}`).toEqual([]);
  }
);

it(
  "lint lets a layer use the layers it may of another slice, and shared",
  { timeout: 60_000 },
  async () => {
    const allowed: [path: string, code: string][] = [
      [
        "src/goal-loop/domain/misplaced.ts",
        'export type { PageStateCapture } from "../../page-state/domain";\nexport { callers } from "../../shared";',
      ],
      [
        "src/goal-loop/application/misplaced.ts",
        'export { acceptedRefNodes } from "../../tools/application";\nexport type Capture = import("../../page-state/domain").PageStateCapture;',
      ],
      [
        "src/tools/infrastructure/misplaced.ts",
        'export const load = () => import("../../page-state/infrastructure");',
      ],
      [
        "src/runtime/misplaced.ts",
        'export { cursors } from "../page-state/infrastructure";',
      ],
      [
        "src/misplaced.ts",
        'export { createPage } from "./page-objects/infrastructure";',
      ],
      [
        "src/goal-loop/domain/misplaced.test.ts",
        'export { listRegisteredPoms } from "../../page-objects/infrastructure";',
      ],
    ];
    for (const [path, code] of allowed)
      expect(await lint(path, `${code}\n`), `${path}: ${code}`).toEqual([]);
  }
);

// The layer rule's options, as lint applies them to a layered slice's file.
const layerRule = "horizontal-boundaries/dependencies";
type LayerPolicy = { allow?: unknown };
async function layerRuleOptions() {
  const config = (await eslint.calculateConfigForFile(
    join(packageRoot, "src/runs/domain/file.ts")
  )) as { rules: Record<string, [unknown, { policies: LayerPolicy[] }]> };
  return config.rules[layerRule]![1];
}

it(
  "every exception to the layer order still names an import lint would refuse",
  { timeout: 120_000 },
  async () => {
    const options = await layerRuleOptions();
    // eslint.config.js's exceptions are the rule's only allow policies.
    const exceptions = options.policies.filter((policy) => policy.allow);
    expect(exceptions.length).toBeGreaterThan(0);
    for (const exception of exceptions) {
      const { from, allow } = exception as {
        from: { file: { path: string } };
        allow: { to: { file: { path: string } } };
      };
      const without = new ESLint({
        cwd: packageRoot,
        overrideConfig: {
          files: [from.file.path],
          rules: {
            [layerRule]: [
              "error",
              {
                ...options,
                policies: options.policies.filter(
                  (policy) => policy !== exception
                ),
              },
            ],
          },
        },
      });
      const [result] = await without.lintFiles(
        join(packageRoot, from.file.path)
      );
      expect(
        result!.messages.filter(({ ruleId }) => ruleId === layerRule),
        `${from.file.path} no longer imports ${allow.to.file.path} against the layer order: remove its exception from eslint.config.js`
      ).not.toEqual([]);
    }
  }
);
