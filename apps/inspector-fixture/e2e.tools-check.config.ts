import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  budgetsOf,
  directPageObjects,
  serveProjectTools,
} from "@ayme-dev/e2e-tools";
import { acp } from "@e2e-dev/acp";
import type { E2EConfig, JsonValue, StepExecutorContext } from "e2e";

import baseConfig from "./e2e.config";
import { build } from "./tests/e2e/tools/pageObjects";

// Model-free check of the Page Object study's third arm, on the patched e2e
// (`packages/e2e-tools/README.md`): a scripted executor calls the e2e suite's
// Page Objects as tools through e2e's tool accounting, the path an agent's
// call takes. Each step's params name the call: `tool`, and `input` as JSON.
// The first run records each call with its input; with
// `AYME_E2E_CACHE=read-only`, every step must replay from the recording, and
// the executor fails any step that reaches it. With `AYME_E2E_EXECUTOR=acp`
// as well, the replay repeats each call through the patched ACP executor's
// `tools` option instead, whose agent command fails if anything starts it.

const here = path.dirname(fileURLToPath(import.meta.url));
const pageObjects = directPageObjects({
  entry: path.join(here, "tests/e2e/tools/pageObjects.ts"),
  build,
});
const replayOnly = process.env.AYME_E2E_CACHE === "read-only";

const call = (ctx: StepExecutorContext, tool: string, input: JsonValue) =>
  budgetsOf(ctx).runTool({ name: tool, mutates: true, replay: { input } }, () =>
    pageObjects.run(tool, input)
  );

const scripted = {
  name: "ayme-scripted",
  version: "1",
  async runStep(ctx: StepExecutorContext) {
    if (replayOnly)
      return {
        status: "failed" as const,
        summary: `"${ctx.step.instruction}" did not replay from the recording`,
      };
    const { tool, input = "{}" } = (ctx.step.params ?? {}) as Record<
      string,
      string
    >;
    if (tool === undefined)
      return {
        status: "blocked" as const,
        errorCode: "AUTOMATION_UNSUPPORTED" as const,
        summary: "the step names no tool",
      };
    await call(ctx, tool, JSON.parse(input) as JsonValue);
    return { status: "passed" as const, summary: `ran ${tool}` };
  },
  // The patched e2e's hook: a cached replay repeats a recorded call.
  async replayTool(ctx: StepExecutorContext, name: string, input: JsonValue) {
    await call(ctx, name, input);
  },
};

// The ACP executor as arm 3 configures it, with an agent that cannot start.
const acpOptions = {
  command: "false",
  tools: serveProjectTools(pageObjects.projectTools()),
};

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
