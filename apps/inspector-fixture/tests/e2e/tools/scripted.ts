import type { ServedTool } from "@ayme-dev/e2e-tools";
import type { JsonValue, StepExecutorContext } from "e2e";

// A model-free stand-in for arm 3's agent: it answers each step with the
// Page Object Tool calls a plan names, through the tools arm 3 serves its
// agent, so they go through e2e's tool accounting as the agent's calls do.

/** One call of a served tool, with its input as JSON. */
export type Call = { readonly tool: string; readonly input: object };

/** The calls that answer a step, and the node to tap if they fail (`button "Model"`), as an agent would heal. */
export type Plan = { readonly calls: readonly Call[]; readonly heal?: string };

/** Taps the one node the observation lists with `roleAndName`, e.g. `button "Model"`. */
async function heal(ctx: StepExecutorContext, roleAndName: string) {
  const { text } = await ctx.observe();
  const line = text.split("\n").find((at) => at.includes(` ${roleAndName}`));
  const id = /^\s*#?(\S+)/.exec(line ?? "")?.[1];
  if (id === undefined) throw new Error(`no ${roleAndName} on screen to heal`);
  await ctx.actions.tap({ id });
}

export function scriptedExecutor(
  served: (ctx: StepExecutorContext) => Promise<ServedTool[]>,
  planOf: (ctx: StepExecutorContext) => Plan | undefined,
  /** Fails every step that reaches the executor: each must replay from its recording. */
  replayOnly: boolean
) {
  const call = async (
    ctx: StepExecutorContext,
    { tool, input }: Call,
    replaying = false
  ) => {
    const found = (await served(ctx)).find((listed) => listed.name === tool);
    if (found === undefined) throw new Error(`no tool ${tool}`);
    await found.run(input as JsonValue, {
      ctx,
      observe: async () => "",
      replaying,
    });
  };
  /**
   * A call made on the tab in front, as the agent sees it. A Page Object on a
   * tab in the back is refused, so this switches to the other tab with e2e's
   * own action and calls again, as an agent would.
   */
  const inFront = async (ctx: StepExecutorContext, planned: Call) => {
    try {
      await call(ctx, planned);
    } catch (error) {
      const { tabs } = await ctx.observe();
      if (
        !String(error).includes("not the one in front") ||
        !tabs ||
        tabs.count < 2
      )
        throw error;
      await ctx.actions.switchTab(tabs.active === 1 ? tabs.count : 1);
      await call(ctx, planned);
    }
  };
  return {
    name: "ayme-scripted",
    version: "1",
    async runStep(ctx: StepExecutorContext) {
      if (replayOnly)
        return {
          status: "failed" as const,
          summary: `"${ctx.step.instruction}" did not replay from the recording`,
        };
      const plan = planOf(ctx);
      if (plan === undefined)
        return {
          status: "blocked" as const,
          errorCode: "AUTOMATION_UNSUPPORTED" as const,
          summary: `no scripted calls for "${ctx.step.instruction}"`,
        };
      try {
        for (const planned of plan.calls) await inFront(ctx, planned);
      } catch (error) {
        if (plan.heal === undefined) throw error;
        await heal(ctx, plan.heal);
        return { status: "passed" as const, summary: "healed" };
      }
      return {
        status: "passed" as const,
        summary: `ran ${plan.calls.map(({ tool }) => tool).join(", ")}`,
      };
    },
    // The patched e2e's hook: a cached replay repeats a recorded call.
    async replayTool(ctx: StepExecutorContext, tool: string, input: JsonValue) {
      await call(ctx, { tool, input: input as object }, true);
    },
  };
}
