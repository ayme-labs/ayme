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
    "src/tools/application/elementTools.ts",
    "export const title = () => document.title;",
    "Only a slice's infrastructure may use the browser's globals.",
  ],
  [
    "src/tools/application/misplaced.ts",
    'export { createRunQueue } from "../../runs/application/run";',
    "Import another slice through its index.ts.",
  ],
  [
    "src/goal-loop/domain/misplaced.ts",
    'export { createDecisionEndpoint } from "../index";',
    "Inside a slice, import the module itself, not the slice's index.ts.",
  ],
  [
    "src/page-objects/application/misplaced.ts",
    'export { litePageDriver } from "../infrastructure/litePageDriver";',
    "application may only depend on the allowed horizontal layers",
  ],
  [
    "src/page-state/misplaced.ts",
    'export { createPage } from "../page-objects";',
    "page-state may only use shared",
  ],
  [
    "src/page-state/misplaced.ts",
    'export type { ToolRunOptions } from "../runs";',
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
    "Import another slice through its index.ts.",
  ],
  [
    "src/tools/misplaced.ts",
    'export type Context = import("../runs/application/run").RunContext;',
    "Import another slice through its index.ts.",
  ],
  [
    "src/tools/misplaced.test.ts",
    'export type Context = import("../runs/application/run").RunContext;',
    "Import another slice through its index.ts.",
  ],
  [
    "src/tools/misplaced.test.ts",
    'export const load = () => vi.importActual<typeof import("../runs/application/run")>("../runs");',
    "Import another slice through its index.ts.",
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
