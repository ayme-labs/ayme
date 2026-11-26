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

type Execute = (input: unknown, options: object) => unknown;

const executeOf = (name: string, defined: DefinedTool): Execute => {
  const execute = (defined.tool as { execute?: Execute }).execute;
  if (execute === undefined)
    throw new Error(`project tool ${name} has no execute`);
  return execute;
};

/** The tools as the patched `@e2e-dev/acp`'s `tools` option takes them: `claudeCode({ tools: serveProjectTools(...) })`. */
export function serveProjectTools(
  tools: Readonly<Record<string, DefinedTool>>
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
      async run(args, { ctx, observe }) {
        const result = await budgetsOf(ctx).runTool(
          {
            name,
            mutates,
            ...(repeatable === true
              ? { replay: { input: args as JsonValue } }
              : {}),
          },
          async () => execute(args, {})
        );
        const text =
          typeof result === "string" ? result : JSON.stringify(result);
        // After a change, the screen as the action tools report it, so the
        // agent can go on with them.
        return mutates ? [text, await observe()].join("\n\n") : text;
      },
    };
  });
  return () => Promise.resolve(served);
}
