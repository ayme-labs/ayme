import type { PageTool, ToolCall, ToolCallOutcome } from "../../contract";
import type { AgentConnection } from "./agentConnection";

/**
 * The page's tools, as the page client reaches them: the `tools` member of
 * the runtime object Ayme's setup returns.
 */
export type PageTools = {
  list(): readonly PageTool[];
  subscribe(listener: (tools: readonly PageTool[]) => void): () => void;
  run(name: string, input: unknown): Promise<unknown>;
};

/** The page's end of the channel to its paired server. */
export type PageChannel = {
  /** Reports the page's tools to the server. */
  publishTools(tools: readonly PageTool[]): Promise<void>;
  /** Runs `handler` for every call the server sends and answers with its outcome. */
  answerCalls(
    handler: (call: ToolCall) => Promise<ToolCallOutcome>
  ): () => void;
  close(): void;
};

/**
 * Something the page client does while its channel is open. It starts when
 * the channel opens and returns what stops it.
 */
export type ClientBehaviour = (context: {
  tools: PageTools;
  channel: PageChannel;
}) => () => void;

/**
 * Something the server does with its Agent Connection while it runs. It
 * starts with the server and returns what stops it.
 */
export type ConnectionBehaviour = (context: {
  connection: AgentConnection;
  /** Writes a line to stderr; stdout carries only MCP messages. */
  log(message: string): void;
}) => () => void;
