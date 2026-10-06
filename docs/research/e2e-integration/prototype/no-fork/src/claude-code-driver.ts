/**
 * The Claude Code agent driver, on the Claude Agent SDK.
 *
 * A session is one SDK query in streaming-input mode: each `send` is one
 * user message, and the turn's result message ends it. The session has no
 * built-in Claude Code tool (no Bash, Read, Edit, web): its only tools come
 * from one in-process MCP server built from the solver's tool specs, all
 * approved up front, and nothing from user or project settings loads. Its
 * environment keeps no Anthropic, Claude, or OpenRouter variable of the
 * process; the one credential it gets is `CLAUDE_CODE_OAUTH_TOKEN`, read
 * when a session starts from the env file `tokenFile` names (only that
 * line), and never written or logged.
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
  AgentDriver,
  AgentSession,
  AgentToolSpec,
  TurnReport,
} from "./agent-solver.ts";

const SERVER = "e2e";
const ISOLATED_VARIABLES =
  /^(ANTHROPIC_.*|CLAUDE_.*|CLAUDECODE|.*OPENROUTER.*)$/i;

function oauthToken(file: string): string {
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

export function claudeCodeDriver(options: {
  readonly model?: string;
  readonly tokenFile: string;
  readonly stderrFile?: string;
}): AgentDriver {
  const model = options.model ?? "sonnet";
  return {
    name: "claude-code",
    start({ systemPrompt, tools }): AgentSession {
      const inbox = new Inbox();
      const abortController = new AbortController();
      const waiters: ((result: SDKResultMessage | undefined) => void)[] = [];
      const state: {
        ended: boolean;
        error?: string;
        init?: Record<string, unknown>;
        costSoFar: number;
      } = { ended: false, costSoFar: 0 };
      const cwd = path.join(tmpdir(), "ayme-e2e-claude-code");
      mkdirSync(cwd, { recursive: true });
      const server = createSdkMcpServer({
        name: SERVER,
        version: "1",
        tools: tools.map((spec: AgentToolSpec) =>
          tool(spec.name, spec.description, spec.input, async (args) => {
            const result = await spec.run(args as Record<string, unknown>);
            return {
              content: [{ type: "text" as const, text: result.text }],
              ...(result.isError === true ? { isError: true } : {}),
            };
          })
        ),
      });
      const conversation = query({
        prompt: inbox,
        options: {
          model,
          systemPrompt,
          tools: [],
          mcpServers: { [SERVER]: server },
          strictMcpConfig: true,
          allowedTools: tools.map((spec) => `mcp__${SERVER}__${spec.name}`),
          permissionMode: "dontAsk",
          settingSources: [],
          skills: [],
          persistSession: false,
          cwd,
          abortController,
          ...(options.stderrFile === undefined
            ? {}
            : {
                stderr: (data: string) =>
                  appendFileSync(options.stderrFile!, data),
              }),
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                ([key]) => !ISOLATED_VARIABLES.test(key)
              )
            ),
            CLAUDE_AGENT_SDK_CLIENT_APP: "ayme-e2e/0",
            CLAUDE_CODE_OAUTH_TOKEN: oauthToken(options.tokenFile),
          },
        },
      });
      void (async () => {
        try {
          for await (const message of conversation as AsyncIterable<SDKMessage>) {
            if (message.type === "system" && message.subtype === "init")
              state.init = {
                apiKeySource: message.apiKeySource,
                model: message.model,
              };
            if (message.type === "result") waiters.shift()?.(message);
          }
        } catch (cause) {
          state.error = cause instanceof Error ? cause.message : String(cause);
        } finally {
          state.ended = true;
          for (const waiter of waiters.splice(0)) waiter(undefined);
        }
      })();
      return {
        get error() {
          return state.error;
        },
        async send(text): Promise<TurnReport | undefined> {
          if (state.ended) return undefined;
          const result = await new Promise<SDKResultMessage | undefined>(
            (resolve) => {
              waiters.push(resolve);
              inbox.push(text);
            }
          );
          if (result === undefined) return undefined;
          const costUsd = result.total_cost_usd - state.costSoFar;
          state.costSoFar = result.total_cost_usd;
          return {
            turns: result.num_turns,
            durationMs: result.duration_ms,
            costUsd,
            provider: "anthropic",
            ...(typeof state.init?.["model"] === "string"
              ? { modelId: state.init["model"] as string }
              : {}),
            usage: result.usage as unknown as Record<string, unknown>,
            tokens: {
              input:
                result.usage.input_tokens +
                (result.usage.cache_read_input_tokens ?? 0) +
                (result.usage.cache_creation_input_tokens ?? 0),
              output: result.usage.output_tokens,
              cacheRead: result.usage.cache_read_input_tokens ?? 0,
              cacheWrite: result.usage.cache_creation_input_tokens ?? 0,
            },
            detail: {
              ...state.init,
              sessionCostUsd: result.total_cost_usd,
              subtype: result.subtype,
              modelUsage: Object.keys(result.modelUsage),
            },
          };
        },
        close() {
          inbox.close();
          setTimeout(() => abortController.abort(), 2_000).unref();
        },
      };
    },
  };
}
