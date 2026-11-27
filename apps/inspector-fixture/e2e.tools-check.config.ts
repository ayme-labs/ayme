import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertOwnCacheDir,
  assertPatchedE2e,
  importBaseline,
} from "@ayme-dev/e2e-tools";
import { acp } from "@e2e-dev/acp";
import type { E2EConfig, StepExecutorContext } from "e2e";
import type { DefinedTool } from "e2e/agent";

import baseConfig from "./e2e.config";
import { pageObjects, servedTools } from "./tests/e2e/tools/pageObjects";
import { scriptedExecutor, type Plan } from "./tests/e2e/tools/scripted";

// Model-free check of the Page Object study's third arm, run with
// `e2e-patched`, which patches e2e in its own processes only
// (`packages/e2e-tools/README.md`). A scripted executor makes each call
// through the tools arm 3 serves its agent. Each step's params name the
// call: `tool`, and `input` as JSON. The first run records each call with
// its input. Switches, all optional:
// - `AYME_E2E_CACHE=read-only`: every step must replay from the recording;
//   the executor fails any step that reaches it.
// - `AYME_E2E_EXECUTOR=acp`: the replay repeats each call through the
//   patched ACP executor's `tools` option, whose agent command fails if
//   anything starts it.
// - `AYME_E2E_STALE=<tool>`: that tool fails as a stale Page Object would,
//   before it acts. A step whose params carry `heal`, a role and name such
//   as `button "Model"`, then taps that node instead, as an agent would heal.
// - `AYME_E2E_HALF_DONE=<tool>`: that tool acts, then fails, as a call that
//   breaks halfway does; the patched e2e saves nothing of such a step.

await assertPatchedE2e("e2e.tools-check.config.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = ".e2e/cache-tools-check";
const { default: goals } = await importBaseline(
  () => import("./e2e.goals.config")
);
// Arm 1's cache is pinned by `pnpm test:goals` (--cache-dir), not its config.
assertOwnCacheDir("e2e.tools-check.config.ts", here, cacheDir, [
  baseConfig,
  goals,
  { cache: { dir: ".e2e/goals-cache" } },
]);
const replayOnly = process.env.AYME_E2E_CACHE === "read-only";
const stale = process.env.AYME_E2E_STALE;
const halfDone = process.env.AYME_E2E_HALF_DONE;

type Execute = (input: unknown, options: object) => Promise<unknown>;

/** The tools, with the ones `AYME_E2E_STALE` and `AYME_E2E_HALF_DONE` name failing. */
const tools: Record<string, DefinedTool> = Object.fromEntries(
  Object.entries(pageObjects.projectTools()).map(([name, defined]) => {
    if (name !== stale && name !== halfDone) return [name, defined];
    const execute = (defined.tool as { execute: Execute }).execute;
    const tool = {
      ...defined.tool,
      execute: async (input: unknown, options: object) => {
        if (name === halfDone) await execute(input, options);
        throw new Error(
          name === halfDone
            ? `${name}: it acted, then failed (AYME_E2E_HALF_DONE)`
            : `${name}: the Page Object's locator found nothing (AYME_E2E_STALE)`
        );
      },
    };
    return [name, { ...defined, tool }];
  })
);
const served = servedTools(path.join(here, ".e2e/stale-page-objects"), tools);

/** A step's call, from its params. */
const fromParams = ({ step }: StepExecutorContext): Plan | undefined => {
  const params = (step.params ?? {}) as Record<string, string>;
  if (params.tool === undefined) return undefined;
  return {
    calls: [{ tool: params.tool, input: JSON.parse(params.input ?? "{}") }],
    ...(params.heal === undefined ? {} : { heal: params.heal }),
  };
};

// The ACP executor as arm 3 configures it, with an agent that cannot start.
// The `tools` option is the patched executor's (`patched.ts` in e2e-tools).
const acpOptions = { command: "false", tools: served };

export default {
  ...baseConfig,
  tests: "tests/e2e/tools/**/*.check.ts",
  cache: {
    dir: cacheDir,
    mode: replayOnly ? "read-only" : "read-write",
  },
  agents: {
    default: {
      // e2e keys a recording by the agent entry, not by its executor.
      executor:
        process.env.AYME_E2E_EXECUTOR === "acp"
          ? acp(acpOptions)
          : scriptedExecutor(served, fromParams, replayOnly),
    },
  },
} satisfies E2EConfig;
