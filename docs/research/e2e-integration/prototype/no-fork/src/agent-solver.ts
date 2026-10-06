/**
 * A solver backed by a coding agent session, independent of which agent.
 *
 * One session per test attempt: the first step the store cannot answer
 * starts it, every later one is one more message into it, and the attempt's
 * end closes it. The tools the session offers are defined here once (the
 * screen grammar, the page object tools, and `complete_step`) and act on
 * whichever step is active, so one session serves every step of the test.
 * What is agent-specific, starting a session with these tools, sending a
 * message and waiting for the turn to end, and closing it, is an
 * `AgentDriver` (`claude-code-driver.ts` today; Codex, Cursor, or OpenCode
 * drivers later).
 */

import type { JsonValue, StepExecutorContext, StepVerdict } from "e2e";
import { z } from "zod";
import type { SolveStep, Solver } from "./ayme-executor.ts";
import type { PageObjectTools } from "./ayme-tools.ts";
import { describeNode } from "./describe.ts";

/** A tool the session offers: a flat input shape and a handler that returns text for the agent. */
export interface AgentToolSpec {
  readonly name: string;
  readonly description: string;
  readonly input: Record<string, z.ZodType>;
  readonly run: (
    args: Record<string, unknown>
  ) => Promise<{ readonly text: string; readonly isError?: boolean }>;
}

/** What one turn cost, as the agent reports it. */
export interface TurnReport {
  readonly turns: number;
  readonly durationMs: number;
  /** This turn's own cost, when the agent reports one. */
  readonly costUsd?: number;
  readonly usage?: Record<string, unknown>;
  /** This turn's tokens, when the agent reports them; e2e's run summary shows them. */
  readonly tokens?: {
    readonly input?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
  };
  /** The provider and model that served the turn, as the agent reports them. */
  readonly provider?: string;
  readonly modelId?: string;
  /** Driver-specific detail for the log (model, credential source, ...). */
  readonly detail?: Record<string, unknown>;
}

export interface AgentSession {
  /** Sends one message and resolves when the agent's turn ends; undefined when the session ended instead. */
  send(text: string): Promise<TurnReport | undefined>;
  close(): void;
  /** Why the session ended, when it did. */
  readonly error: string | undefined;
}

export interface AgentDriver {
  readonly name: string;
  start(options: {
    readonly systemPrompt: string;
    readonly tools: readonly AgentToolSpec[];
  }): AgentSession;
}

const SYSTEM_PROMPT = `You are an end-to-end testing agent driving a real web application in a browser.
Each user message is one test step: an instruction, its parameters, and the current screen.
The screen is a tree of nodes, one per line, each with an id like "n42" that you pass to the action tools.
Prefer a page object tool when one does what the step asks; otherwise act on the screen with the action tools.
Work only toward the given step. Each action tool returns the screen after it.
When the screen shows the step's outcome, call complete_step with status "passed" and a one-line summary.
If the step cannot be done, call complete_step with status "failed" and say why.
You have no access to the application's source code, files, shell, or network: only these tools.`;

/** The step a session serves now. */
interface ActiveStep {
  readonly step: SolveStep;
  /** The page object tools live now: set at the step's start, refreshed after every action. */
  live: ReadonlySet<string> | undefined;
  verdict: StepVerdict | undefined;
  readonly toolCalls: string[];
}

const MEMORY_KEY = "ayme-e2e.agent-session";

export function agentSolver(
  driver: AgentDriver,
  options: { readonly offerPageObjects: boolean }
): Solver {
  return {
    name: driver.name,
    async solve(step) {
      const { ctx } = step;
      let held = ctx.attempt.memory.get(MEMORY_KEY) as
        | { session: AgentSession; slot: { active: ActiveStep | undefined } }
        | undefined;
      const started = held === undefined;
      if (held === undefined) {
        const slot: { active: ActiveStep | undefined } = { active: undefined };
        const session = driver.start({
          systemPrompt: SYSTEM_PROMPT,
          tools: toolSpecs(slot, options.offerPageObjects ? step.tools : {}),
        });
        ctx.attempt.signal.addEventListener("abort", () => session.close(), {
          once: true,
        });
        held = { session, slot };
        ctx.attempt.memory.set(MEMORY_KEY, held);
      }
      const active: ActiveStep = {
        step,
        live: step.available,
        verdict: undefined,
        toolCalls: [],
      };
      held.slot.active = active;
      const report = await held.session.send(await stepMessage(step));
      held.slot.active = undefined;
      if (report !== undefined) {
        ctx.budgets.recordModelCall({
          durationMs: report.durationMs,
          ...(report.tokens?.input === undefined
            ? {}
            : { inputTokens: report.tokens.input }),
          ...(report.tokens?.output === undefined
            ? {}
            : { outputTokens: report.tokens.output }),
          ...(report.tokens?.cacheRead === undefined
            ? {}
            : { cacheReadTokens: report.tokens.cacheRead }),
          ...(report.tokens?.cacheWrite === undefined
            ? {}
            : { cacheWriteTokens: report.tokens.cacheWrite }),
          ...(report.provider === undefined
            ? {}
            : { provider: report.provider }),
          ...(report.modelId === undefined ? {} : { modelId: report.modelId }),
          ...(report.costUsd === undefined
            ? {}
            : { estimatedCostUsd: report.costUsd }),
        });
      }
      const verdict: StepVerdict = active.verdict ?? {
        status: "failed",
        errorCode: "ACTION_FAILED",
        summary:
          report === undefined
            ? `the agent session ended: ${held.session.error ?? "no result"}`
            : "the agent ended its turn without complete_step",
      };
      return {
        verdict,
        log: {
          driver: driver.name,
          sessionStarted: started,
          toolCalls: active.toolCalls,
          turn: report ?? null,
        },
      };
    },
  };
}

/** The user message for one step: instruction, params, what already ran, and the screen. */
async function stepMessage(step: SolveStep): Promise<string> {
  const { ctx } = step;
  const parts = [`Step: ${ctx.step.instruction}`];
  if (ctx.step.params !== undefined)
    parts.push(`Parameters: ${JSON.stringify(ctx.step.params)}`);
  if (ctx.ledger !== "")
    parts.push(
      `Steps completed so far in this test, including any replayed without you:\n${ctx.ledger}`
    );
  if (step.note !== undefined) parts.push(step.note);
  if (step.available !== undefined && Object.keys(step.tools).length > 0) {
    const live = Object.keys(step.tools).filter((name) =>
      step.available!.has(name)
    );
    parts.push(
      `Page object tools available on this screen: ${live.length === 0 ? "none" : live.join(", ")}.`
    );
  }
  if (ctx.replayedPrefix !== undefined) {
    parts.push(
      `A cached replay already performed these actions for this step: ${ctx.replayedPrefix.replayedActions.join("; ")}. It stopped (${ctx.replayedPrefix.stopReason}). Continue from the current screen; do not redo them.`
    );
  }
  parts.push(`Current screen:\n${(await ctx.observe()).text}`);
  return parts.join("\n\n");
}

/** The session's tools, each acting on the step active when the agent calls it. */
function toolSpecs(
  slot: { active: ActiveStep | undefined },
  pageObjects: PageObjectTools
): AgentToolSpec[] {
  const current = (name: string): ActiveStep => {
    const active = slot.active;
    if (active === undefined || active.verdict !== undefined)
      throw new Error("no step is active; wait for the next instruction");
    active.toolCalls.push(name);
    return active;
  };
  /**
   * Runs an action on the active step and returns the screen after it, or
   * the failure as a tool error. With liveness on, the result also lists the
   * page object tools live after the action: mounting a component can make
   * one available mid-step.
   */
  const act =
    (
      name: string,
      body: (step: SolveStep, ctx: StepExecutorContext) => Promise<unknown>
    ) =>
    async (): Promise<{ text: string; isError?: boolean }> => {
      try {
        const active = current(name);
        const { step } = active;
        await body(step, step.ctx);
        let liveLine = "";
        if (
          step.refreshAvailable !== undefined &&
          Object.keys(pageObjects).length > 0
        ) {
          active.live = await step.refreshAvailable();
          const live = Object.keys(pageObjects).filter((tool) =>
            active.live!.has(tool)
          );
          liveLine = `\n\nPage object tools available now: ${live.length === 0 ? "none" : live.join(", ")}.`;
        }
        return {
          text: `${name} done.${liveLine}\n\n${(await step.ctx.observe()).text}`,
        };
      } catch (cause) {
        return {
          text: `${name} failed: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`,
          isError: true,
        };
      }
    };
  const grammar =
    (
      name: string,
      body: (
        ctx: StepExecutorContext,
        args: Record<string, unknown>
      ) => Promise<unknown>
    ) =>
    (args: Record<string, unknown>) =>
      act(name, async (step, ctx) => {
        // Resolved before acting: the action may take the node off the screen.
        const target =
          typeof args["id"] === "string"
            ? await describeNode(ctx, args["id"])
            : undefined;
        await body(ctx, args);
        step.recordGrammar(name, target);
      })();
  const id = z.string().describe("node id from the latest screen, e.g. n42");
  const specs: AgentToolSpec[] = [
    {
      name: "observe",
      description: "Read the current screen.",
      input: {},
      run: () => act("observe", async () => undefined)(),
    },
    {
      name: "tap",
      description: "Tap (click) a node.",
      input: { id },
      run: grammar("tap", (ctx, a) =>
        ctx.actions.tap({ id: a["id"] as string })
      ),
    },
    {
      name: "type",
      description: "Replace the text of a field.",
      input: { id, value: z.string() },
      run: grammar("type", (ctx, a) =>
        ctx.actions.type({ id: a["id"] as string }, a["value"] as string)
      ),
    },
    {
      name: "select",
      description: "Choose an option of a select by its label.",
      input: { id, value: z.string() },
      run: grammar("select", (ctx, a) =>
        ctx.actions.select({ id: a["id"] as string }, a["value"] as string)
      ),
    },
    {
      name: "check",
      description: "Set a checkbox, switch, or radio.",
      input: { id, checked: z.boolean() },
      run: grammar("check", (ctx, a) =>
        ctx.actions.check({ id: a["id"] as string }, a["checked"] as boolean)
      ),
    },
    {
      name: "press",
      description: "Press a key on a node, e.g. Enter.",
      input: { id, key: z.string() },
      run: grammar("press", (ctx, a) =>
        ctx.actions.press({ id: a["id"] as string }, a["key"] as string)
      ),
    },
    {
      name: "scroll",
      description: "Scroll the page, or a list by id.",
      input: {
        direction: z.enum(["up", "down", "left", "right"]),
        id: z.string().optional(),
      },
      run: grammar("scroll", (ctx, a) =>
        ctx.actions.scroll(
          a["direction"] as "up",
          a["id"] === undefined ? undefined : { id: a["id"] as string }
        )
      ),
    },
    {
      name: "navigate",
      description: "Open a URL or a path of the app.",
      input: { url: z.string() },
      run: grammar("navigate", (ctx, a) =>
        ctx.actions.navigate(a["url"] as string)
      ),
    },
    {
      name: "back",
      description: "Go back one page.",
      input: {},
      run: grammar("back", (ctx) => ctx.actions.back()),
    },
    {
      name: "complete_step",
      description: "End the current step with a verdict.",
      input: { status: z.enum(["passed", "failed"]), summary: z.string() },
      run: async (args) => {
        try {
          const active = current("complete_step");
          const summary = String(args["summary"]);
          active.verdict =
            args["status"] === "passed"
              ? { status: "passed", summary }
              : { status: "failed", summary, errorCode: "ACTION_FAILED" };
          return { text: "Step recorded. Wait for the next instruction." };
        } catch (cause) {
          return { text: String(cause), isError: true };
        }
      },
    },
  ];
  for (const [name, defined] of Object.entries(pageObjects)) {
    const { description, inputSchema } = defined.tool as {
      description?: string;
      inputSchema: {
        jsonSchema: { properties?: Record<string, { type?: string }> };
      };
    };
    specs.push({
      name,
      description: `Page object action: ${description ?? name}`,
      input: shapeOf(inputSchema.jsonSchema),
      run: (args) =>
        act(name, async (step) => {
          const live = slot.active?.live;
          if (live !== undefined && !live.has(name))
            throw new Error(`${name} is not available on this screen`);
          return step.callTool(name, args as JsonValue);
        })(),
    });
  }
  return specs;
}

/** A flat input shape for a page object's JSON Schema: strings, numbers, booleans. */
function shapeOf(schema: {
  properties?: Record<string, { type?: string }>;
}): Record<string, z.ZodType> {
  return Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([key, property]) => [
      key,
      property.type === "number" || property.type === "integer"
        ? z.number()
        : property.type === "boolean"
          ? z.boolean()
          : z.string(),
    ])
  );
}
