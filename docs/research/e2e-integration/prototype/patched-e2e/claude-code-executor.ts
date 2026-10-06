/**
 * An e2e step executor backed by Claude Code through the Claude Agent SDK.
 *
 * One Claude Code session per test attempt: the first `agent.act` of the
 * attempt starts it in streaming-input mode, every later `act` of the same
 * attempt is one more user message into it, and the attempt's end closes it.
 * The session has no built-in Claude Code tool at all (no Bash, Read, Edit,
 * web): its only tools come from one in-process MCP server, and each of them
 * calls whichever step is active now, through that step's policed and
 * recorded `ctx.actions`, `ctx.observe`, and `ctx.budgets.runTool`. A page
 * object tool goes through `runTool` with `replay: 'call'`, so the replay
 * cache records the call itself. `complete_step` ends the step with a
 * verdict.
 *
 * Every step is logged as one JSON line to `SPIKE_LOG`: whether it started a
 * session, the turn's result (turns, duration, cumulative cost, usage), and
 * the tools the agent called.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createSdkMcpServer,
  query,
  tool,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  JsonValue,
  StepExecutor,
  StepExecutorContext,
  StepVerdict,
} from "e2e";
import type { defineTool } from "e2e/agent";
import { z } from "zod";

type Tools = Record<string, ReturnType<typeof defineTool>>;
type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const SERVER = "e2e";
const MEMORY_KEY = "ayme-spike.claude-code-session";

const SYSTEM_PROMPT = `You are an end-to-end testing agent driving a real web application in a browser.
Each user message is one test step: an instruction, its parameters, and the current screen.
The screen is a tree of nodes, one per line, each with an id like "n42" that you pass to the action tools.
Work only toward the given step. Act through the tools; each action tool returns the screen after it.
When the screen shows the step's outcome, call complete_step with status "passed" and a one-line summary.
If the step cannot be done, call complete_step with status "failed" and say why.
You have no access to the application's source code, files, shell, or network: only these tools.`;

/**
 * Variables kept from the session's process: none that pick a credential or
 * endpoint (an API key, a token, a base URL, OpenRouter's), and none of a
 * Claude Code session the runner itself may be running in (its session id,
 * messaging socket, host auth). The session then signs in like a fresh
 * `claude` on this Mac: with the stored Claude Code login.
 */
const CREDENTIAL_VARIABLES =
  /^(ANTHROPIC_.*|CLAUDE_.*|CLAUDECODE|.*OPENROUTER.*)$/i;

/**
 * The one credential the session gets: `CLAUDE_CODE_OAUTH_TOKEN`, read at run
 * time from the git-ignored env file `SPIKE_CLAUDE_TOKEN_FILE` names (the
 * Evals runs' file). Only that line is taken; every other line of the file
 * is ignored, and the value is never written or logged anywhere.
 */
function claudeCodeToken(): string {
  const file = process.env.SPIKE_CLAUDE_TOKEN_FILE;
  if (file === undefined)
    throw new Error(
      "set SPIKE_CLAUDE_TOKEN_FILE to the env file holding CLAUDE_CODE_OAUTH_TOKEN"
    );
  const prefix = "CLAUDE_CODE_OAUTH_TOKEN=";
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(prefix));
  const token = line
    ?.slice(prefix.length)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (token === undefined || token === "")
    throw new Error(`no CLAUDE_CODE_OAUTH_TOKEN in ${file}`);
  return token;
}

/** A push-based async iterable: the session's streaming input. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private readonly queue: SDKUserMessage[] = [];
  private waiting:
    ((result: IteratorResult<SDKUserMessage>) => void) | undefined;
  private closed = false;

  push(text: string): void {
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    };
    if (this.waiting !== undefined) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve({ value: message, done: false });
    } else this.queue.push(message);
  }

  close(): void {
    this.closed = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const message = this.queue.shift();
        if (message !== undefined)
          return Promise.resolve({ value: message, done: false });
        if (this.closed)
          return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

/** The step a session is serving now, and how its tools settle it. */
interface ActiveStep {
  readonly ctx: StepExecutorContext;
  verdict: StepVerdict | undefined;
  readonly toolCalls: string[];
}

/** One Claude Code session, serving the `act` steps of one test attempt in order. */
class Session {
  readonly inbox = new Inbox();
  active: ActiveStep | undefined;
  private readonly results: SDKResultMessage[] = [];
  private waiters: ((result: SDKResultMessage | undefined) => void)[] = [];
  private ended = false;
  error: string | undefined;
  /** What the session reported when it started: the credential source, the model, and its tools. */
  init: { apiKeySource: string; model: string; tools: string[] } | undefined;
  /** The cumulative cost the previous turn's result reported, so each turn's own cost is the difference. */
  costSoFarUsd = 0;

  constructor(options: {
    model: string;
    tools: Tools;
    arm: "stock" | "ayme";
    signal: AbortSignal;
  }) {
    const server = createSdkMcpServer({
      name: SERVER,
      version: "1",
      tools: this.mcpTools(options.arm, options.tools),
    });
    const cwd = path.join(tmpdir(), "ayme-spike-claude-code");
    mkdirSync(cwd, { recursive: true });
    const abortController = new AbortController();
    options.signal.addEventListener(
      "abort",
      () => this.close(abortController),
      { once: true }
    );
    const conversation = query({
      prompt: this.inbox,
      options: {
        model: options.model,
        systemPrompt: SYSTEM_PROMPT,
        // No built-in Claude Code tool; only this server's tools, approved up front.
        tools: [],
        mcpServers: { [SERVER]: server },
        strictMcpConfig: true,
        allowedTools: this.toolNames(options.arm, options.tools).map(
          (name) => `mcp__${SERVER}__${name}`
        ),
        permissionMode: "dontAsk",
        // No user or project settings, hooks, CLAUDE.md, plugins, or skills.
        settingSources: [],
        skills: [],
        persistSession: false,
        cwd,
        ...(process.env.SPIKE_LOG === undefined
          ? {}
          : {
              stderr: (data: string) =>
                appendFileSync(`${process.env.SPIKE_LOG}.stderr`, data),
            }),
        abortController,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !CREDENTIAL_VARIABLES.test(key)
            )
          ),
          CLAUDE_AGENT_SDK_CLIENT_APP: "ayme-spike/0",
          CLAUDE_CODE_OAUTH_TOKEN: claudeCodeToken(),
        },
      },
    });
    void this.pump(conversation);
  }

  /** Reads the session's messages, handing each turn's result to the step waiting for it. */
  private async pump(conversation: AsyncIterable<SDKMessage>): Promise<void> {
    try {
      for await (const message of conversation) {
        if (message.type === "system" && message.subtype === "init") {
          this.init = {
            apiKeySource: message.apiKeySource,
            model: message.model,
            tools: message.tools,
          };
        }
        if (message.type === "result") {
          this.results.push(message);
          this.waiters.shift()?.(message);
        }
      }
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      this.ended = true;
      for (const waiter of this.waiters.splice(0)) waiter(undefined);
    }
  }

  /** Sends one step's message and waits for the turn it starts to end. */
  turn(text: string): Promise<SDKResultMessage | undefined> {
    if (this.ended) return Promise.resolve(undefined);
    const result = new Promise<SDKResultMessage | undefined>((resolve) =>
      this.waiters.push(resolve)
    );
    this.inbox.push(text);
    return result;
  }

  private close(abortController: AbortController): void {
    this.inbox.close();
    // Give the process a moment to end on its own after its input closes.
    setTimeout(() => abortController.abort(), 2_000).unref();
  }

  private toolNames(arm: "stock" | "ayme", tools: Tools): string[] {
    const grammar = [
      "observe",
      "tap",
      "type",
      "select",
      "check",
      "press",
      "scroll",
      "navigate",
      "back",
      "complete_step",
    ];
    return arm === "ayme" ? [...grammar, ...Object.keys(tools)] : grammar;
  }

  /** The step these tools act on: whichever is active when the model calls them. */
  private step(name: string): ActiveStep {
    const active = this.active;
    if (active === undefined || active.verdict !== undefined)
      throw new Error("no step is active; wait for the next instruction");
    active.toolCalls.push(name);
    return active;
  }

  /** Runs an action, then returns the screen after it, or the failure as a tool error. */
  private async act(
    name: string,
    body: (ctx: StepExecutorContext) => Promise<unknown>
  ): Promise<ToolResult> {
    try {
      const { ctx } = this.step(name);
      await body(ctx);
      return text(`${name} done.\n\n${(await ctx.observe()).text}`);
    } catch (cause) {
      return {
        ...text(
          `${name} failed: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`
        ),
        isError: true,
      };
    }
  }

  private mcpTools(arm: "stock" | "ayme", tools: Tools) {
    const id = z.string().describe("node id from the latest screen, e.g. n42");
    const grammar = [
      tool("observe", "Read the current screen.", {}, async () =>
        this.act("observe", async () => undefined)
      ),
      tool("tap", "Tap (click) a node.", { id }, async ({ id: node }) =>
        this.act("tap", (ctx) => ctx.actions.tap({ id: node }))
      ),
      tool(
        "type",
        "Replace the text of a field.",
        { id, value: z.string() },
        async ({ id: node, value }) =>
          this.act("type", (ctx) => ctx.actions.type({ id: node }, value))
      ),
      tool(
        "select",
        "Choose an option of a select by its label.",
        { id, value: z.string() },
        async ({ id: node, value }) =>
          this.act("select", (ctx) => ctx.actions.select({ id: node }, value))
      ),
      tool(
        "check",
        "Set a checkbox, switch, or radio.",
        { id, checked: z.boolean() },
        async ({ id: node, checked }) =>
          this.act("check", (ctx) => ctx.actions.check({ id: node }, checked))
      ),
      tool(
        "press",
        "Press a key on a node, e.g. Enter.",
        { id, key: z.string() },
        async ({ id: node, key }) =>
          this.act("press", (ctx) => ctx.actions.press({ id: node }, key))
      ),
      tool(
        "scroll",
        "Scroll the page, or a list by id.",
        {
          direction: z.enum(["up", "down", "left", "right"]),
          id: z.string().optional(),
        },
        async ({ direction, id: node }) =>
          this.act("scroll", (ctx) =>
            ctx.actions.scroll(
              direction,
              node === undefined ? undefined : { id: node }
            )
          )
      ),
      tool(
        "navigate",
        "Open a URL or a path of the app.",
        { url: z.string() },
        async ({ url }) =>
          this.act("navigate", (ctx) => ctx.actions.navigate(url))
      ),
      tool("back", "Go back one page.", {}, async () =>
        this.act("back", (ctx) => ctx.actions.back())
      ),
      tool(
        "complete_step",
        "End the current step with a verdict.",
        { status: z.enum(["passed", "failed"]), summary: z.string() },
        async ({ status, summary }) => {
          try {
            const active = this.step("complete_step");
            active.verdict =
              status === "passed"
                ? { status, summary }
                : { status, summary, errorCode: "ACTION_FAILED" };
            return text("Step recorded. Wait for the next instruction.");
          } catch (cause) {
            return { ...text(String(cause)), isError: true };
          }
        }
      ),
    ];
    if (arm === "stock") return grammar;
    const pageObjects = Object.entries(tools).map(([name, defined]) => {
      const { description, inputSchema, execute } = defined.tool as {
        description?: string;
        inputSchema: {
          jsonSchema: { properties?: Record<string, { type?: string }> };
        };
        execute: (input: unknown, options: unknown) => Promise<unknown>;
      };
      return tool(
        name,
        `Page object action: ${description ?? name}`,
        shapeOf(inputSchema.jsonSchema),
        async (args) =>
          this.act(name, (ctx) =>
            ctx.budgets.runTool(
              { name, mutates: true, replay: "call", args: args as JsonValue },
              () =>
                execute(args, {
                  toolCallId: name,
                  messages: [],
                  context: undefined,
                })
            )
          )
      );
    });
    return [...grammar, ...pageObjects];
  }
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

/** A zod shape for a page object's flat JSON Schema input: strings, numbers, booleans. */
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

/** The user message for one step: instruction, params, what replay already did, and the screen. */
async function stepMessage(ctx: StepExecutorContext): Promise<string> {
  const parts = [`Step: ${ctx.step.instruction}`];
  // The session sees only the acts it was handed; one the cache replayed in
  // between, and every check the test ran, are in the test's ledger.
  if (ctx.ledger !== "")
    parts.push(
      `Steps completed so far in this test, including any the cache replayed without you:\n${ctx.ledger}`
    );
  if (ctx.step.params !== undefined)
    parts.push(`Parameters: ${JSON.stringify(ctx.step.params)}`);
  if (ctx.replayedToolFailure !== undefined) {
    parts.push(
      `A recorded call of ${ctx.replayedToolFailure.tool} for this step just failed (${ctx.replayedToolFailure.error}). Do not call it again; reach the goal another way.`
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

export function claudeCodeExecutor(options: {
  arm: "stock" | "ayme";
  model?: string;
  tools?: Tools;
}): StepExecutor {
  const model = options.model ?? process.env.SPIKE_CLAUDE_MODEL ?? "sonnet";
  const tools = options.tools ?? {};
  return {
    name: `claude-code-${options.arm}`,
    version: "1",
    cache: "inherit",
    ...(options.arm === "ayme" ? { replayTools: tools } : {}),
    async runStep(ctx): Promise<StepVerdict> {
      if (ctx.step.kind !== "act") {
        return {
          status: "blocked",
          errorCode: "AUTOMATION_UNSUPPORTED",
          summary: "this executor runs act steps only",
        };
      }
      let session = ctx.attempt.memory.get(MEMORY_KEY) as Session | undefined;
      const started = session === undefined;
      if (session === undefined) {
        session = new Session({
          model,
          tools,
          arm: options.arm,
          signal: ctx.attempt.signal,
        });
        ctx.attempt.memory.set(MEMORY_KEY, session);
      }
      const active: ActiveStep = { ctx, verdict: undefined, toolCalls: [] };
      session.active = active;
      const startedMs = Date.now();
      const result = await session.turn(await stepMessage(ctx));
      session.active = undefined;
      const turnCostUsd =
        result === undefined ? 0 : result.total_cost_usd - session.costSoFarUsd;
      if (result !== undefined) session.costSoFarUsd = result.total_cost_usd;
      if (result !== undefined) {
        ctx.budgets.recordModelCall({
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
          durationMs: result.duration_ms,
          provider: "anthropic",
          modelId: model,
          estimatedCostUsd: turnCostUsd,
        });
      }
      if (process.env.SPIKE_LOG !== undefined) {
        appendFileSync(
          process.env.SPIKE_LOG,
          `${JSON.stringify({
            arm: options.arm,
            phase: process.env.SPIKE_PHASE,
            test: ctx.attempt.testId,
            sessionStarted: started,
            ...(started ? { init: session.init ?? null } : {}),
            wallMs: Date.now() - startedMs,
            toolCalls: active.toolCalls,
            replayedPrefix: ctx.replayedPrefix ?? null,
            replayedToolFailure: ctx.replayedToolFailure ?? null,
            result:
              result === undefined
                ? { missing: true, error: session.error ?? null }
                : {
                    subtype: result.subtype,
                    numTurns: result.num_turns,
                    durationMs: result.duration_ms,
                    turnCostUsd,
                    sessionCostUsd: result.total_cost_usd,
                    usage: result.usage,
                    modelUsage: result.modelUsage,
                  },
          })}\n`
        );
      }
      if (active.verdict !== undefined) return active.verdict;
      return {
        status: "failed",
        errorCode: "ACTION_FAILED",
        summary:
          result === undefined
            ? `the Claude Code session ended: ${session.error ?? "no result"}`
            : "the agent ended its turn without complete_step",
      };
    },
  };
}
