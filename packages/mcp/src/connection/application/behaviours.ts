import type {
  ImageResult,
  PageLeaving,
  PageTool,
  ToolCall,
  ToolCallOutcome,
} from "../../contract";
import type { AgentConnection } from "./agentConnection";

type ListedPageTool = PageTool;

/**
 * The page's or App Process's tools, as its client reaches them: the
 * `tools` member of the runtime object Ayme's setup returns. Each says
 * whether a call can run it now, and why not when it cannot.
 */
export type PageTools = {
  list(): readonly ListedPageTool[];
  subscribe(listener: (tools: readonly ListedPageTool[]) => void): () => void;
  run(name: string, input: unknown): Promise<unknown>;
};

/**
 * A call the agent made through the server whose result is an image, such
 * as a screenshot, as the page's Inspector records it.
 */
export type AgentImageRun = {
  name: string;
  input: unknown;
  result: ImageResult;
  /** The file the server saves it to, when the server named its folder. */
  savedTo: string | undefined;
  /** When the call started, in epoch milliseconds. */
  startedAt: number;
  durationMs: number;
};

/** The page's or App Process's end of the channel to its paired server. */
export type PageChannel = {
  /** The folder the server saves a tool's images to, once its welcome named it. */
  readonly imageFolder: string | undefined;
  /** Reports the tools to the server. */
  publishTools(tools: readonly PageTool[]): Promise<void>;
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
   * Calls `listener` with the names of the App Process's tools the agent
   * does not see,
   * which the server sends at once and after every change. An App Process
   * only; returns what stops it.
   */
  followHiddenTools(listener: (hidden: readonly string[]) => void): () => void;
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
  /** Records an agent's call whose result is an image, for the page's Inspector. */
  recordAgentImage?: (run: AgentImageRun) => void;
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
