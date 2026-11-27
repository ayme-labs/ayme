/**
 * e2e config tools on e2e's ACP executor.
 *
 * e2e's built-in agent serves the tools of `agents.<name>.tools`. An entry
 * with a custom `executor` may not set `tools`, and the ACP executor is one,
 * so a config tool never reaches an agent over ACP. `serveProjectTools` hands
 * the same tools to the patched `@e2e-dev/acp` (its `tools` option), for any
 * config tool, not only Page Object Tools. A call of a tool marked
 * `repeatable` goes through e2e's tool accounting with its input, so the
 * patched e2e records it and a cached replay runs it again.
 */

import type { JsonValue, StepExecutorContext } from "e2e";
import type { DefinedTool } from "e2e/agent";
import { budgetsOf, type ServedTool } from "./patched";
import type { ToolFailure } from "./stale";

type Execute = (input: unknown, options: object) => unknown;

/** The calls, tool and input, that failed in a test and are refused for the rest of it, in the attempt's memory. */
const droppedIn = (ctx: StepExecutorContext): Map<string, string> => {
  const key = `ayme-e2e-tools.dropped:${ctx.attempt.testId}`;
  let dropped = ctx.attempt.memory.get(key) as Map<string, string> | undefined;
  if (dropped === undefined) ctx.attempt.memory.set(key, (dropped = new Map()));
  return dropped;
};

/** A call that waited in the action queue past its step's end, and did not act. */
class StepEnded extends Error {
  constructor() {
    super("The step has ended. Wait for the next instruction.");
  }
}

const firstLine = (error: unknown) =>
  String(error instanceof Error ? error.message : error).split("\n")[0] ?? "";

const executeOf = (name: string, defined: DefinedTool): Execute => {
  const execute = (defined.tool as { execute?: Execute }).execute;
  if (execute === undefined)
    throw new Error(`project tool ${name} has no execute`);
  return execute;
};

/** The tools as the patched `@e2e-dev/acp`'s `tools` option takes them: `claudeCode({ tools: serveProjectTools(...) })`. */
export function serveProjectTools(
  tools: Readonly<Record<string, DefinedTool>>,
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
  const served = Object.entries(tools).map(([name, defined]): ServedTool => {
    const execute = executeOf(name, defined);
    const { mutates } = defined.annotations;
    // The patched e2e's annotation (`patched.ts`).
    const { repeatable } = defined.annotations as { repeatable?: boolean };
    return {
      name,
      description: defined.tool.description ?? name,
      inputSchema: defined.tool.inputSchema,
      readOnly: !mutates,
      ...(options.hidden === undefined
        ? {}
        : { hidden: async () => (await options.hidden?.(name)) ?? false }),
      async run(args, { ctx, observe, replaying, stepEnded }) {
        const call = `${name} ${JSON.stringify(args ?? {})}`;
        const dropped = droppedIn(ctx).get(call);
        if (dropped !== undefined)
          throw new Error(
            `${name} failed earlier in this test with this input (${dropped}). Call it with other input, or reach the goal with the other action tools.`
          );
        const result = await budgetsOf(ctx)
          .runTool(
            {
              name,
              mutates,
              ...(repeatable === true
                ? { replay: { input: args as JsonValue } }
                : {}),
            },
            async () => {
              // In the queue, before anything acts: a step ended meanwhile is left alone.
              if (stepEnded?.() === true) throw new StepEnded();
              return execute(args, {});
            }
          )
          .catch((error: unknown) => {
            if (error instanceof StepEnded) throw error;
            const failure: ToolFailure = {
              tool: name,
              input: args as JsonValue,
              error,
              during: replaying === true ? "replay" : "live",
              test: ctx.attempt.testId,
              instruction: ctx.step.instruction,
            };
            options.onFailure?.(failure);
            if (options.dropAfterFailure?.(failure) === true)
              droppedIn(ctx).set(call, firstLine(error));
            throw error;
          });
        const text =
          typeof result === "string" ? result : JSON.stringify(result);
        if (!mutates) return text;
        // After a change, the screen as the action tools report it, so the
        // agent can go on with them. The call ran and is recorded whatever
        // the look does, so a look that fails still answers that it ran.
        const screen = await observe().catch(
          (error: unknown) =>
            `The screen could not be read after the call (${firstLine(error)}).`
        );
        return [text, screen].join("\n\n");
      },
    };
  });
  return () => Promise.resolve(served);
}
