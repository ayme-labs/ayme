/**
 * An agent driver over the Agent Client Protocol (ACP), for any agent that
 * speaks it on stdio: the Claude adapter, Cursor's `agent acp`, the Codex
 * adapter.
 *
 * A session is one agent process: it starts in an empty temporary directory,
 * gets `initialize` and one `session/new`, and each `send` is one
 * `session/prompt` that resolves when the prompt turn ends. The solver's
 * tools reach the agent as one MCP server this process serves over
 * streamable HTTP on 127.0.0.1 (an ephemeral port and a random path per
 * session), so every tool runs here, against the running test. The client
 * advertises no file system or terminal capability, and answers permission
 * requests itself: calls of its own MCP tools are allowed, everything else
 * is rejected. ACP has no system prompt field, so the system prompt leads the
 * first message, unless `systemPrompt: 'meta'` passes it as `_meta.systemPrompt`
 * (a Claude adapter extension). The agent's environment keeps no Anthropic,
 * Claude, or OpenRouter variable of this process; `env` adds what the agent
 * needs and is read when a session starts.
 */

import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type InitializeResponse,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
  type ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type {
  AgentDriver,
  AgentSession,
  AgentToolSpec,
  TurnReport,
} from "./agent-solver.ts";

/** The MCP server name the agent sees; distinctive, so a permission request that names it is about our tools. */
export const ACP_MCP_SERVER = "ayme_e2e";
const ISOLATED_VARIABLES =
  /^(ANTHROPIC_.*|CLAUDE_.*|CLAUDECODE|.*OPENROUTER.*)$/i;
/** Tool kinds that are never one of our MCP tools, whatever their title says. */
const BUILT_IN_KINDS = new Set([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "fetch",
  "switch_mode",
]);

export interface AcpDriverOptions {
  /** The driver name in logs, e.g. `acp-cursor`. */
  readonly name: string;
  readonly command: string;
  readonly args?: readonly string[];
  /** Variables the agent gets on top of the filtered environment, read when a session starts. */
  readonly env?: () => Record<string, string>;
  /** The value of the session's model config option to select; a session fails when the agent does not offer it. */
  readonly model?: string;
  /** A session mode id to select, e.g. Codex's `read-only`. */
  readonly mode?: string;
  /** `_meta` for `session/new`: agent-specific session options. */
  readonly meta?: Record<string, unknown>;
  /** Where the system prompt goes: before the first message (default), or `_meta.systemPrompt` (Claude adapter). */
  readonly systemPrompt?: "first-prompt" | "meta";
  /** Whether the agent's `inputTokens` already count cached input (OpenAI style) rather than exclude it (Anthropic style). */
  readonly inputIncludesCache?: boolean;
  readonly stderrFile?: string;
}

/** What the agent said about itself when the session started. */
export interface AcpSessionInfo {
  readonly initialize: InitializeResponse;
  readonly session: NewSessionResponse;
  /** The model config option's values, when the agent has one. */
  readonly models: readonly string[];
  /** Extension notifications the agent sent (e.g. `_auth/status_update`). */
  readonly notices: readonly {
    readonly method: string;
    readonly params: Record<string, unknown>;
  }[];
  readonly mcpUrl: string;
}

export interface AcpSession extends AgentSession {
  /** Settles once `initialize`, `session/new`, and the model and mode selection are done. */
  readonly ready: Promise<AcpSessionInfo>;
  /** HTTP requests our MCP server has answered so far: zero means the agent never connected to it. */
  readonly mcpRequests: number;
}

/** One turn's observations from session updates and permission requests. */
interface TurnLog {
  toolCalls: number;
  /** Every tool call the agent reported this turn, ours or its own: what ran, permission asked or not. */
  seen: { title?: string; kind?: string }[];
  mcpCalls: number;
  permissions: { title: string; kind: string | null; allowed: boolean }[];
  text: string;
}

export function acpDriver(options: AcpDriverOptions): AgentDriver & {
  start(input: Parameters<AgentDriver["start"]>[0]): AcpSession;
} {
  return {
    name: options.name,
    start({ systemPrompt, tools }): AcpSession {
      const cwd = mkdtempSync(path.join(tmpdir(), "ayme-e2e-acp-"));
      const state: {
        error?: string;
        ended: boolean;
        turn?: TurnLog | undefined;
        costSoFar?: number | undefined;
        cost?: number;
        sentFirst: boolean;
        calls: KnownCalls;
      } = {
        ended: false,
        sentFirst: false,
        calls: new Map(),
      };
      const notices: { method: string; params: Record<string, unknown> }[] = [];
      const fail = (message: string) => {
        state.error ??= message;
        state.ended = true;
      };

      const mcp = serveTools(tools, () => {
        if (state.turn !== undefined) state.turn.mcpCalls++;
      });
      const child = spawn(options.command, [...(options.args ?? [])], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !ISOLATED_VARIABLES.test(key)
            )
          ),
          ...options.env?.(),
        } as NodeJS.ProcessEnv,
      });
      child.stderr.on("data", (data: Buffer) => {
        if (options.stderrFile !== undefined)
          appendFileSync(options.stderrFile, data);
      });
      // A dead agent must not take the test process down with a pipe error.
      child.stdin.on("error", () => undefined);
      const exited = new Promise<never>((_, reject) => {
        child.on("error", (cause) => {
          fail(`could not start ${options.command}: ${cause.message}`);
          reject(new Error(state.error));
        });
        child.on("exit", (code, signal) => {
          fail(`the agent process exited (${signal ?? `code ${code}`})`);
          reject(new Error(state.error));
        });
      });
      exited.catch(() => undefined);

      const client: Client = {
        requestPermission: (params) =>
          answerPermission(params, state.calls, state.turn),
        sessionUpdate: (params) => observe(params, state),
        extNotification: (method, params) => {
          notices.push({ method, params });
        },
      };
      const connection = new ClientSideConnection(
        () => client,
        ndJsonStream(
          Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
          Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
        )
      );

      const ready = (async (): Promise<AcpSessionInfo> => {
        const { url } = await mcp.started;
        const initialize = await Promise.race([
          exited,
          connection.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false,
            },
            clientInfo: { name: "ayme-e2e", version: "0" },
          }),
        ]);
        if (initialize.agentCapabilities?.mcpCapabilities?.http !== true) {
          throw new Error(
            `${options.name} does not accept HTTP MCP servers (mcpCapabilities: ${JSON.stringify(initialize.agentCapabilities?.mcpCapabilities ?? {})})`
          );
        }
        const meta = {
          ...options.meta,
          ...(options.systemPrompt === "meta" ? { systemPrompt } : {}),
        };
        const session = await Promise.race([
          exited,
          connection.newSession({
            cwd,
            mcpServers: [
              { type: "http", name: ACP_MCP_SERVER, url, headers: [] },
            ],
            ...(Object.keys(meta).length === 0 ? {} : { _meta: meta }),
          }),
        ]);
        const modelOption = session.configOptions?.find(
          (option) => option.category === "model" || option.id === "model"
        );
        const models =
          modelOption === undefined ? [] : selectValues(modelOption);
        if (options.model !== undefined) {
          if (modelOption === undefined)
            throw new Error(
              `${options.name} offers no model config option; cannot select ${options.model}`
            );
          if (!models.includes(options.model))
            throw new Error(
              `${options.name} does not offer model ${options.model}; it offers: ${models.join(", ")}`
            );
          await connection.setSessionConfigOption({
            sessionId: session.sessionId,
            configId: modelOption.id,
            value: options.model,
          });
        }
        if (options.mode !== undefined) {
          const modeOption = session.configOptions?.find(
            (option) => option.category === "mode"
          );
          if (
            modeOption !== undefined &&
            selectValues(modeOption).includes(options.mode)
          ) {
            await connection.setSessionConfigOption({
              sessionId: session.sessionId,
              configId: modeOption.id,
              value: options.mode,
            });
          } else if (
            session.modes?.availableModes.some(
              (mode) => mode.id === options.mode
            ) === true
          ) {
            await connection.setSessionMode({
              sessionId: session.sessionId,
              modeId: options.mode,
            });
          } else {
            throw new Error(`${options.name} has no mode ${options.mode}`);
          }
        }
        return { initialize, session, models, notices, mcpUrl: url };
      })();
      ready.catch((cause: unknown) =>
        fail(cause instanceof Error ? cause.message : String(cause))
      );

      let closed = false;
      return {
        ready,
        get error() {
          return state.error;
        },
        get mcpRequests() {
          return mcp.requests;
        },
        async send(text): Promise<TurnReport | undefined> {
          let info: AcpSessionInfo;
          try {
            info = await ready;
          } catch {
            return undefined;
          }
          if (state.ended) return undefined;
          const turn: TurnLog = {
            toolCalls: 0,
            seen: [],
            mcpCalls: 0,
            permissions: [],
            text: "",
          };
          state.turn = turn;
          const prompt = [
            ...(state.sentFirst || options.systemPrompt === "meta"
              ? []
              : [{ type: "text" as const, text: systemPrompt }]),
            { type: "text" as const, text },
          ];
          state.sentFirst = true;
          const startedMs = Date.now();
          let response: PromptResponse;
          try {
            response = await Promise.race([
              connection.prompt({ sessionId: info.session.sessionId, prompt }),
              exited,
            ]);
          } catch (cause) {
            fail(
              `session/prompt failed: ${cause instanceof Error ? cause.message : JSON.stringify(cause)}`
            );
            return undefined;
          } finally {
            state.turn = undefined;
          }
          const usage = response.usage ?? undefined;
          const costUsd =
            state.cost === undefined
              ? undefined
              : state.cost - (state.costSoFar ?? 0);
          state.costSoFar = state.cost;
          const cacheRead = usage?.cachedReadTokens ?? 0;
          const cacheWrite = usage?.cachedWriteTokens ?? 0;
          return {
            // Model requests are not reported over ACP: each call of our tools is one more request after the first.
            turns: turn.mcpCalls + 1,
            durationMs: Date.now() - startedMs,
            ...(costUsd === undefined ? {} : { costUsd }),
            ...(options.model === undefined ? {} : { modelId: options.model }),
            ...(usage === undefined
              ? {}
              : {
                  usage: usage as unknown as Record<string, unknown>,
                  tokens: {
                    input:
                      options.inputIncludesCache === true
                        ? usage.inputTokens
                        : usage.inputTokens + cacheRead + cacheWrite,
                    output: usage.outputTokens,
                    cacheRead,
                    cacheWrite,
                  },
                }),
            detail: {
              agent: info.initialize.agentInfo ?? null,
              stopReason: response.stopReason,
              toolCallUpdates: turn.toolCalls,
              toolCallsSeen: turn.seen,
              mcpCalls: turn.mcpCalls,
              mcpRequests: mcp.requests,
              permissions: turn.permissions,
              sessionCostUsd: state.cost ?? null,
              responseMeta: response._meta ?? null,
              lastText: turn.text.slice(-500),
            },
          };
        },
        close() {
          if (closed) return;
          closed = true;
          fail("the session was closed");
          void (async () => {
            try {
              // An adapter that never finished initializing gets no close
              // request: the wait is bounded so the process still goes.
              const info = await Promise.race([
                ready,
                new Promise<undefined>((resolve) =>
                  setTimeout(() => resolve(undefined), 2_000).unref()
                ),
              ]);
              if (
                info !== undefined &&
                info.initialize.agentCapabilities?.sessionCapabilities?.close !=
                  null
              ) {
                await Promise.race([
                  connection.closeSession({
                    sessionId: info.session.sessionId,
                  }),
                  new Promise((resolve) => setTimeout(resolve, 2_000).unref()),
                ]);
              }
            } catch {
              // The process goes either way.
            }
            child.stdin.end();
            child.kill("SIGTERM");
            setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null)
                child.kill("SIGKILL");
            }, 3_000).unref();
            await mcp.close();
            rmSync(cwd, { recursive: true, force: true });
          })();
        },
      };
    },
  };
}

/** The values of a select config option, flattening groups. */
function selectValues(option: SessionConfigOption): string[] {
  if (option.type !== "select") return [];
  return option.options.flatMap((entry) =>
    "group" in entry ? entry.options.map((inner) => inner.value) : [entry.value]
  );
}

/** What the session's tool call reports said about each tool call, by id: a permission request may carry only the id. */
type KnownCalls = Map<string, Partial<ToolCallUpdate>>;

function observe(
  { update }: SessionNotification,
  state: { turn?: TurnLog | undefined; cost?: number; calls: KnownCalls }
): void {
  switch (update.sessionUpdate) {
    case "tool_call":
    case "tool_call_update": {
      if (update.sessionUpdate === "tool_call" && state.turn !== undefined) {
        state.turn.toolCalls++;
        state.turn.seen.push({
          ...(update.title == null ? {} : { title: update.title }),
          ...(update.kind == null ? {} : { kind: update.kind }),
        });
      }
      const fields: Partial<ToolCallUpdate> = { ...update };
      delete (fields as { sessionUpdate?: unknown }).sessionUpdate;
      state.calls.set(update.toolCallId, {
        ...state.calls.get(update.toolCallId),
        ...definedFields(fields),
      });
      break;
    }
    case "agent_message_chunk":
      if (state.turn !== undefined && update.content.type === "text")
        state.turn.text += update.content.text;
      break;
    case "usage_update":
      // The cumulative session cost, when the agent reports one (USD only).
      if (update.cost != null && update.cost.currency === "USD")
        state.cost = update.cost.amount;
      break;
    default:
      break;
  }
}

function definedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, field]) => field !== undefined && field !== null
    )
  ) as Partial<T>;
}

/** Allows calls of our MCP tools; rejects everything else. */
function answerPermission(
  params: RequestPermissionRequest,
  calls: KnownCalls,
  turn: TurnLog | undefined
): RequestPermissionResponse {
  const toolCall = {
    ...calls.get(params.toolCall.toolCallId),
    ...definedFields(params.toolCall),
  };
  const allowed = isOurTool(toolCall, params._meta ?? undefined);
  turn?.permissions.push({
    title: toolCall.title ?? "",
    kind: toolCall.kind ?? null,
    allowed,
  });
  const kinds = allowed
    ? ["allow_once", "allow_always"]
    : ["reject_once", "reject_always"];
  const option = kinds
    .map((kind) => params.options.find((candidate) => candidate.kind === kind))
    .find((candidate) => candidate !== undefined);
  return option === undefined
    ? { outcome: { outcome: "cancelled" } }
    : { outcome: { outcome: "selected", optionId: option.optionId } };
}

function isOurTool(
  toolCall: Partial<ToolCallUpdate>,
  requestMeta: Record<string, unknown> | undefined
): boolean {
  const meta = (toolCall._meta ?? {}) as {
    claudeCode?: { toolName?: unknown; mcpServer?: { name?: unknown } };
  };
  // The Claude adapter names the tool and its MCP server.
  if (meta.claudeCode !== undefined) {
    return (
      meta.claudeCode.mcpServer?.name === ACP_MCP_SERVER ||
      (typeof meta.claudeCode.toolName === "string" &&
        meta.claudeCode.toolName.startsWith(`mcp__${ACP_MCP_SERVER}__`))
    );
  }
  // The Codex adapter marks MCP tool approvals; the server is in the approval's raw input, or in the
  // raw input of the tool call it reported before (title `mcp.<server>.<tool>`, kind `execute`).
  const raw = (toolCall.rawInput ?? {}) as {
    serverName?: unknown;
    server?: unknown;
  };
  if (requestMeta?.["is_mcp_tool_approval"] === true)
    return raw.serverName === ACP_MCP_SERVER || raw.server === ACP_MCP_SERVER;
  // Otherwise, a request that is not a built-in kind and names our server in its title, name, or raw input.
  if (toolCall.kind != null && BUILT_IN_KINDS.has(toolCall.kind)) return false;
  return [
    toolCall.title,
    toolCall.name,
    JSON.stringify(toolCall.rawInput ?? null),
  ].some(
    (field) => typeof field === "string" && field.includes(ACP_MCP_SERVER)
  );
}

/** Serves the tools as one MCP server over stateless streamable HTTP on 127.0.0.1. */
function serveTools(
  tools: readonly AgentToolSpec[],
  onCall: () => void
): {
  started: Promise<{ url: string }>;
  readonly requests: number;
  close(): Promise<void>;
} {
  const route = `/${randomUUID()}/mcp`;
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    if (request.url !== route) {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    const mcp = new McpServer({ name: ACP_MCP_SERVER, version: "1" });
    for (const spec of tools) {
      mcp.registerTool(
        spec.name,
        { description: spec.description, inputSchema: spec.input },
        async (args: Record<string, unknown>) => {
          onCall();
          const result = await spec.run(args);
          return {
            content: [{ type: "text" as const, text: result.text }],
            ...(result.isError === true ? { isError: true } : {}),
          };
        }
      );
    }
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    response.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    void (async () => {
      try {
        // Stateless (no session id generator); the cast bridges the SDK types under exactOptionalPropertyTypes.
        await mcp.connect(
          transport as unknown as Parameters<McpServer["connect"]>[0]
        );
        await transport.handleRequest(request, response);
      } catch (cause) {
        if (!response.headersSent) response.writeHead(500).end(String(cause));
      }
    })();
  });
  const started = new Promise<{ url: string }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}${route}`,
      })
    );
  });
  return {
    started,
    get requests() {
      return requests;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
