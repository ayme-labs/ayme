/**
 * A model-free stand-in for the agent, for the mechanics run of the
 * comparison. It plays "create a project named {name}" the way a model
 * would: the stock arm finds the controls on screen by role and a loose name
 * match (so it still works after the button is renamed) and acts through the
 * grammar; the ayme arm calls the page object tool, recorded as a
 * `replay: 'call'` tool call, and falls back to the grammar when that call
 * fails. Every `runStep` is one model re-solve in real use; each is logged
 * as one JSON line to `SPIKE_LOG`.
 */

import { appendFileSync } from "node:fs";
import type {
  ExecutorNode,
  StepExecutor,
  StepExecutorContext,
  StepVerdict,
} from "e2e";
import type { defineTool } from "e2e/agent";

type Tools = Record<string, ReturnType<typeof defineTool>>;

const POM_TOOL = "ProjectsPage_createProject";

function find(
  node: ExecutorNode | undefined,
  matches: (node: ExecutorNode) => boolean
): ExecutorNode | undefined {
  if (node === undefined) return undefined;
  if (matches(node)) return node;
  for (const child of node.children ?? []) {
    const found = find(child, matches);
    if (found !== undefined) return found;
  }
  return undefined;
}

async function requireNode(
  ctx: StepExecutorContext,
  what: string,
  matches: (node: ExecutorNode) => boolean
): Promise<ExecutorNode> {
  const found = find((await ctx.observe({ tree: true })).tree, matches);
  if (found === undefined) throw new Error(`no ${what} on screen`);
  return found;
}

/** The grammar path: open the form, fill the name, submit, each control found by role and a loose name. */
async function createByGrammar(
  ctx: StepExecutorContext,
  name: string
): Promise<void> {
  const open = await requireNode(
    ctx,
    "new-project button",
    (n) =>
      n.role === "button" && /\b(new|add)\b.*\bproject\b/i.test(n.name ?? "")
  );
  await ctx.actions.tap({ id: open.id });
  const field = await requireNode(
    ctx,
    "project name field",
    (n) => n.role === "textbox" && /project name/i.test(n.name ?? "")
  );
  await ctx.actions.type({ id: field.id }, name);
  const submit = await requireNode(
    ctx,
    "create button",
    (n) => n.role === "button" && /^create( project)?$/i.test(n.name ?? "")
  );
  await ctx.actions.tap({ id: submit.id });
}

/** The page object path, through the accounting that records it as a replayable call. */
async function createByPageObject(
  ctx: StepExecutorContext,
  tools: Tools,
  name: string
): Promise<void> {
  const tool = tools[POM_TOOL]!.tool as {
    execute: (input: unknown, options: unknown) => Promise<unknown>;
  };
  const args = { name };
  await ctx.budgets.runTool(
    { name: POM_TOOL, mutates: true, replay: "call", args },
    () =>
      tool.execute(args, {
        toolCallId: "scripted",
        messages: [],
        context: undefined,
      })
  );
}

export function scriptedExecutor(
  arm: "stock" | "ayme",
  tools: Tools = {}
): StepExecutor {
  return {
    name: `scripted-${arm}`,
    version: "1",
    cache: "inherit",
    ...(arm === "ayme" ? { replayTools: tools } : {}),
    async runStep(ctx): Promise<StepVerdict> {
      const name = ctx.step.params?.["name"];
      if (ctx.step.kind !== "act" || typeof name !== "string") {
        return {
          status: "blocked",
          errorCode: "AUTOMATION_UNSUPPORTED",
          summary: 'only "create a project named {name}" is scripted',
        };
      }
      let path: string = arm === "ayme" ? "page-object" : "grammar";
      let pomError: string | undefined;
      if (arm === "ayme" && ctx.replayedToolFailure?.tool === POM_TOOL) {
        // Replay just ran this call and it failed: a model told so goes
        // straight for the controls instead of calling it again.
        pomError = ctx.replayedToolFailure.error;
        path = "replay-failed-then-grammar";
        await createByGrammar(ctx, name);
      } else if (arm === "ayme") {
        try {
          await createByPageObject(ctx, tools, name);
        } catch (cause) {
          pomError = (
            cause instanceof Error ? cause.message : String(cause)
          ).split("\n")[0];
          path = "page-object-failed-then-grammar";
          await createByGrammar(ctx, name);
        }
      } else {
        await createByGrammar(ctx, name);
      }
      if (process.env.SPIKE_LOG !== undefined) {
        appendFileSync(
          process.env.SPIKE_LOG,
          `${JSON.stringify({ arm, phase: process.env.SPIKE_PHASE, step: ctx.step.instruction, path, replayedPrefix: ctx.replayedPrefix ?? null, pomError: pomError ?? null })}\n`
        );
      }
      return { status: "passed", summary: `created project ${name} (${path})` };
    },
  };
}
