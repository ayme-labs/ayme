import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertPatchedE2e } from "@ayme-dev/e2e-tools";
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
// - `AYME_E2E_STALE=<tool>`: that tool fails as a stale Page Object would.
//   A step whose params carry `heal`, a role and name such as
//   `button "Model"`, then taps that node instead, as an agent would heal.

assertPatchedE2e("e2e.tools-check.config.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const replayOnly = process.env.AYME_E2E_CACHE === "read-only";
const stale = process.env.AYME_E2E_STALE;

/** The tools, with the one `AYME_E2E_STALE` names failing as a stale locator does. */
const tools: Record<string, DefinedTool> = Object.fromEntries(
  Object.entries(pageObjects.projectTools()).map(([name, defined]) => {
    if (name !== stale) return [name, defined];
    const tool = {
      ...defined.tool,
      execute: () => {
        throw new Error(
          `${name}: the Page Object's locator found nothing (AYME_E2E_STALE)`
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
    dir: ".e2e/cache-tools-check",
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
