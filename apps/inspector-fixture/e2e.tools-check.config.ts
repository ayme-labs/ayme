import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  directPageObjects,
  serveProjectTools,
  staleNotes,
} from "@ayme-dev/e2e-tools";
import { acp } from "@e2e-dev/acp";
import type { E2EConfig, JsonValue, StepExecutorContext } from "e2e";
import type { DefinedTool } from "e2e/agent";

import baseConfig from "./e2e.config";
import { build } from "./tests/e2e/tools/pageObjects";

// Model-free check of the Page Object study's third arm, on the patched e2e
// (`packages/e2e-tools/README.md`). A scripted executor makes each call
// through the tools arm 3 serves its agent, which go through e2e's tool
// accounting as an agent's call does. Each step's params name the call:
// `tool`, and `input` as JSON. The first run records each call with its
// input. Switches, all optional:
// - `AYME_E2E_CACHE=read-only`: every step must replay from the recording;
//   the executor fails any step that reaches it.
// - `AYME_E2E_EXECUTOR=acp`: the replay repeats each call through the
//   patched ACP executor's `tools` option, whose agent command fails if
//   anything starts it.
// - `AYME_E2E_STALE=<tool>`: that tool fails as a stale Page Object would.
//   A step whose params carry `heal`, a role and name such as
//   `button "Model"`, then taps that node instead, as an agent would heal.

const here = path.dirname(fileURLToPath(import.meta.url));
const pageObjects = directPageObjects({
  entry: path.join(here, "tests/e2e/tools/pageObjects.ts"),
  build,
});
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
const served = serveProjectTools(tools, {
  onFailure: staleNotes(path.join(here, ".e2e/stale-page-objects"), (tool) =>
    pageObjects.sourceOf(tool)
  ),
});

const call = async (
  ctx: StepExecutorContext,
  name: string,
  input: JsonValue,
  replaying = false
) => {
  const tool = (await served(ctx)).find((listed) => listed.name === name);
  if (tool === undefined) throw new Error(`no tool ${name}`);
  await tool.run(input, { ctx, observe: async () => "", replaying });
};

/** Taps the one node the observation lists with `roleAndName`, e.g. `button "Model"`. */
async function heal(ctx: StepExecutorContext, roleAndName: string) {
  const { text } = await ctx.observe();
  const line = text.split("\n").find((at) => at.includes(` ${roleAndName}`));
  const id = /^\s*#?(\S+)/.exec(line ?? "")?.[1];
  if (id === undefined) throw new Error(`no ${roleAndName} on screen to heal`);
  await ctx.actions.tap({ id });
}

const scripted = {
  name: "ayme-scripted",
  version: "1",
  async runStep(ctx: StepExecutorContext) {
    if (replayOnly)
      return {
        status: "failed" as const,
        summary: `"${ctx.step.instruction}" did not replay from the recording`,
      };
    const params = (ctx.step.params ?? {}) as Record<string, string>;
    if (params.tool === undefined)
      return {
        status: "blocked" as const,
        errorCode: "AUTOMATION_UNSUPPORTED" as const,
        summary: "the step names no tool",
      };
    try {
      await call(ctx, params.tool, JSON.parse(params.input ?? "{}"));
    } catch (error) {
      if (params.heal === undefined) throw error;
      await heal(ctx, params.heal);
      return { status: "passed" as const, summary: `healed ${params.tool}` };
    }
    return { status: "passed" as const, summary: `ran ${params.tool}` };
  },
  // The patched e2e's hook: a cached replay repeats a recorded call.
  async replayTool(ctx: StepExecutorContext, name: string, input: JsonValue) {
    await call(ctx, name, input, true);
  },
};

// The ACP executor as arm 3 configures it, with an agent that cannot start.
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
        process.env.AYME_E2E_EXECUTOR === "acp" ? acp(acpOptions) : scripted,
    },
  },
} satisfies E2EConfig;
