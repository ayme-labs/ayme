import type {
  PageLeaving,
  PageTool,
  ToolCall,
  ToolCallOutcome,
  ToolReportAnswer,
} from "../../contract";
import type { AgentConnection } from "./agentConnection";

/**
 * The page's or App Process's tools, as its client reaches them: the
 * `tools` member of the runtime object Ayme's setup returns.
 */
export type PageTools = {
  list(): readonly PageTool[];
  subscribe(listener: (tools: readonly PageTool[]) => void): () => void;
  run(name: string, input: unknown): Promise<unknown>;
};

/** The page's or App Process's end of the channel to its paired server. */
export type PageChannel = {
  /**
   * Reports the tools to the server, which answers with those the agent
   * does not see.
   */
  publishTools(tools: readonly PageTool[]): Promise<ToolReportAnswer>;
  /** Runs `handler` for every call the server sends and answers with its outcome. */
  answerCalls(
    handler: (call: ToolCall) => Promise<ToolCallOutcome>
  ): () => void;
  /** Tells the server the page started loading a new document. */
  reportLeaving(leaving: PageLeaving): Promise<void>;
  /**
   * Calls `listener` with the App Processes' tools the server sends the
   * page, at once and after every change, and with none when the channel
   * closes. A page only; returns what stops it.
   */
  followProcessTools(
    listener: (tools: readonly PageTool[]) => void
  ): () => void;
  /**
   * Asks the server to run an App Process's tool, and resolves with that
   * process's outcome. A page only.
   */
  callProcessTool(name: string, input: unknown): Promise<ToolCallOutcome>;
  close(): void;
};

/**
 * Something the page client or App Process does while its channel is open. It starts when
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
