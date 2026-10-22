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
    "src/goal-loop/domain/misplaced.ts",
    'export { createDecisionEndpoint } from "../index";',
    "Inside a slice, import the module itself, not the slice's index.ts.",
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
