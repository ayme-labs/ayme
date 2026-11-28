/**
 * Page Object Tools on e2e's ACP executor.
 *
 * An entry with a custom `executor` may not set e2e's `tools`, and the ACP
 * executor is one, so a config tool never reaches an agent over ACP.
 * `serveProjectTools` hands the tools to the patched `@e2e-dev/acp` (its
 * `tools` option). Each call goes through e2e's tool accounting with its
 * input, so the patched e2e records it and a cached replay runs it again.
 */

import type { JsonValue, StepExecutorContext } from "e2e";
import { budgetsOf, type ServedTool } from "./patched";
import type { ToolFailure } from "./stale";

/** A tool `serveProjectTools` serves: each call may change the page, and is recorded with its input. */
export interface ExecutableTool {
  readonly description: string;
  /** The input's schema, as the ACP executor's MCP server lists it. */
  readonly inputSchema: unknown;
  /** Runs the call and answers what it did. */
  execute(input: JsonValue): Promise<string>;
}

/** The calls, tool and input, that failed in a test and are refused for the rest of it, in the attempt's memory. */
const droppedIn = (ctx: StepExecutorContext): Map<string, string> => {
  const key = `ayme-e2e-tools.dropped:${ctx.attempt.testId}`;
  let dropped = ctx.attempt.memory.get(key) as Map<string, string> | undefined;
  if (dropped === undefined) ctx.attempt.memory.set(key, (dropped = new Map()));
  return dropped;
};

/** JSON with every object's keys in order, so one input is one key however it was spelled. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, at: unknown) =>
    at !== null && typeof at === "object" && !Array.isArray(at)
      ? Object.fromEntries(
          Object.entries(at).sort(([a], [b]) => (a < b ? -1 : 1))
        )
      : at
  );

const firstLine = (error: unknown) =>
  String(error instanceof Error ? error.message : error).split("\n")[0] ?? "";

/** The tools as the patched `@e2e-dev/acp`'s `tools` option takes them: `claudeCode({ tools: serveProjectTools(...) })`. */
export function serveProjectTools(
  tools: Readonly<Record<string, ExecutableTool>>,
  options: {
    /** Hears of every call that threw, replayed or live, such as `staleNotes`. */
    onFailure?: (failure: ToolFailure) => void;
    /**
     * Whether a tool is left out of the agent's list now, by its name, such
     * as `(tool) => pageObjects.ruledOutNow(tool).then(Boolean)`. Asked
     * whenever the patched ACP executor checks the list (its `hidden`).
     */
    hidden?: (tool: string) => boolean | Promise<boolean>;
    /**
     * Whether a failed call has the same call, the tool with the same input,
     * refused at once for the rest of the test, replayed or live. The tool
     * stays listed for other input: one misspelled label does not take it.
     */
    dropAfterFailure?: (failure: ToolFailure) => boolean;
  } = {}
): (ctx: StepExecutorContext) => Promise<ServedTool[]> {
  const served = Object.entries(tools).map(([name, tool]): ServedTool => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    readOnly: false,
    ...(options.hidden === undefined
      ? {}
      : { hidden: async () => (await options.hidden?.(name)) ?? false }),
    async run(args, { ctx, observe, replaying, stepEnded }) {
      const input = args as JsonValue;
      const call = `${name} ${canonical(input ?? {})}`;
      const text = await budgetsOf(ctx).runTool(
        { name, mutates: true, replay: { input } },
        // In e2e's action queue, one call at a time: a call queued behind
        // the step's end, or behind a failed call with the same input, does
        // not act.
        async () => {
          if (stepEnded?.() === true)
            throw new Error(
              "The step has ended. Wait for the next instruction."
            );
          const dropped = droppedIn(ctx).get(call);
          if (dropped !== undefined)
            throw new Error(
              `${name} failed earlier in this test with this input (${dropped}). Call it with other input, or reach the goal with the other action tools.`
            );
          try {
            return await tool.execute(input);
          } catch (error) {
            const failure: ToolFailure = {
              tool: name,
              input,
              error,
              during: replaying === true ? "replay" : "live",
              test: ctx.attempt.testId,
              instruction: ctx.step.instruction,
            };
            options.onFailure?.(failure);
            if (options.dropAfterFailure?.(failure) === true)
              droppedIn(ctx).set(call, firstLine(error));
            throw error;
          }
        }
      );
      // After a change, the screen as the action tools report it, so the
      // agent can go on with them. The call ran and is recorded whatever
      // the look does, so a look that fails still answers that it ran.
      const screen = await observe().catch(
        (error: unknown) =>
          `The screen could not be read after the call (${firstLine(error)}).`
      );
      return [text, screen].join("\n\n");
    },
  }));
  return () => Promise.resolve(served);
}
