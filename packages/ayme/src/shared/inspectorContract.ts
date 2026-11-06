import type { NotConnectedReason } from "@ayme-dev/mcp/client";

import type { Caller } from "./callers";
import type { JsonSchema, JsonValue } from "./contracts";

// The Inspector contract (ADR-0049): what the runtime tells the Inspector and
// what the Inspector asks of it, as plain data only. Refs, paths, JSON trees,
// manifests and revisions cross it; an `Element` or a `Locator` never does,
// so the same client works inline (direct calls) and, later, over a channel.
// The shape follows a client of commands that answer canonical state, and
// state events that carry a revision.

/**
 * Where a tool comes from: a Page Object (Page Object Tool), Ayme's
 * Browser Tools, the app's Custom Tools, the app's Peeks (Peek Tools), or the
 * agent's own tools (`snapshot`, `goal`).
 */
export type PublishedToolGroup =
  "pageObject" | "browser" | "custom" | "peek" | "agent";

/**
 * A published tool, for reading only, with two descriptions: what its
 * author wrote, and its Agent Description, the text an agent reads. They
 * differ only on a Page Object Tool, whose Agent Description adds the Page
 * Objects the page shows afterwards. A Page Object Tool that says nothing
 * beyond its name and schema has neither.
 */
export type PublishedToolInfo = Readonly<{
  name: string;
  authorDescription?: string;
  agentDescription?: string;
  /**
   * For a Page Object Tool: the other Page Objects its action may return,
   * which the page shows afterwards.
   */
  returnPoms?: readonly string[];
  inputSchema: JsonSchema;
  group: PublishedToolGroup;
  /** The declaring class of a Page Object Tool. */
  className?: string;
}>;

/**
 * A tool of the session, for reading only. `available` says whether a call
 * can run it now: a Page Object Tool is available while its Page Object (or
 * the component instance it acts on) is and its action's availability
 * predicate, if it has one, holds; every other tool always is. `reason`,
 * when the tool is unavailable and there is one, is its Availability Reason:
 * the runtime's, naming the Structural Ref of the element a click would
 * reach instead, or the predicate's string (ADR-0035).
 */
export type ToolInfo = PublishedToolInfo &
  Readonly<{ available: boolean; reason?: string }>;

/**
 * Whether the session's page is connected to a coding agent through the
 * agent's Ayme MCP server, for the Inspector: `off` without the
 * `agentConnection` option, else as the page client reports it.
 * `not-connected` says why once the tab knows, `no-client` when the page
 * client failed to load; `connected` names the agent when its MCP client
 * gave a name, such as `claude-code`.
 */
export type AgentConnectionStatus = Readonly<
  | { state: "off" }
  | {
      state: "not-connected";
      reason?: NotConnectedReason | "no-client";
    }
  | { state: "connected"; agent?: string }
>;

/** A tool of an App Process paired beside the page, read in Node. */
export type AppProcessTool = Readonly<{
  name: string;
  description?: string;
  inputSchema: Readonly<Record<string, unknown>>;
}>;

/** A session's WebMCP publication status. */
export type InspectorPublication = Readonly<{
  state:
    "disabled" | "waiting" | "active" | "unavailable" | "failed" | "disposed";
  message: string;
}>;

/** One input a Run gave the page: what the Run log records of it. */
export type InspectorInteraction = Readonly<{
  operation: string;
  locator?: string;
  ref?: string;
  value?: string;
}>;

/** A Run of the document's Run log, as the log lists it. */
export type InspectorRun = Readonly<
  {
    id: string;
    tool: string;
    input?: JsonValue;
    status: "running" | "succeeded" | "failed";
    result?: JsonValue;
    error?: string;
    startedAt: number;
    durationMs?: number;
    interactions: readonly InspectorInteraction[];
  } & ({ by: Caller; parent?: undefined } | { parent: string; by?: undefined })
>;

/**
 * What the Runs and Tools lenses read, whole: the canonical state. Every
 * change makes a new state with a higher `revision`; a client never lets one
 * with a lower revision replace one it holds.
 */
export type InspectorState = Readonly<{
  revision: number;
  /** Every tool the session lists, in publication order. */
  tools: readonly ToolInfo[];
  appProcessTools: readonly AppProcessTool[];
  publication: InspectorPublication;
  agentConnection: AgentConnectionStatus;
  /** The document's Run log, oldest first. */
  runs: readonly InspectorRun[];
}>;

/** An agent's call whose result is an image, once `ayme mcp` saved it. */
export type InspectorAgentImageRun = Readonly<{
  name: string;
  input: JsonValue;
  /** The file `ayme mcp` saved the image to, when it named its folder. */
  savedTo?: string;
  startedAt: number;
  durationMs: number;
}>;

/**
 * What the runtime pushes. `state` carries the new canonical state;
 * `agent-image-run` reports a fact that is no state, and carries the
 * revision it was seen at.
 */
export type InspectorEvent =
  | Readonly<{ type: "state"; state: InspectorState }>
  | Readonly<{
      type: "agent-image-run";
      revision: number;
      run: InspectorAgentImageRun;
    }>;

/** The two highlights: `hover` (dashed) and `pinned` (solid). */
export type InspectorHighlightLayer = "hover" | "pinned";

/** What a command answers: the canonical state after it. */
export type InspectorCommandResult = Readonly<{
  state: InspectorState;
  /** For `pick`: the Structural Ref picked; absent when picking was cancelled. */
  ref?: string;
  /** For `runTool`: why the Run failed, as the log records it. */
  error?: string;
}>;

export type InspectorObserver = Readonly<{
  onEvent(event: InspectorEvent): void;
  onError(error: Error): void;
}>;

/**
 * The contract: reads, commands and a subscription, all in plain data. The
 * runtime serves it; a client of it shows the Inspector's lenses.
 */
export type InspectorContract = Readonly<{
  getState(): Promise<InspectorState>;
  /** Pushes each new state, from now on. Returns what stops it. */
  subscribe(observer: InspectorObserver): () => void;
  /** Starts a Run of the tool `name` as the Caller `by` names. */
  runTool(request: {
    name: string;
    input?: JsonValue;
    by?: Caller;
  }): Promise<InspectorCommandResult>;
  /**
   * Makes `refs` the elements `layer` highlights on the page: the others it
   * showed end. An element both layers want shows the selection's.
   */
  highlight(request: {
    layer: InspectorHighlightLayer;
    refs: readonly string[];
  }): Promise<InspectorCommandResult>;
  /**
   * Picks a Structural Ref by pointing at the document: elements whose ref is
   * not in `refs` show greyed and cannot be picked. Answers when a click picks
   * one or `cancelPick` (or Esc) ends it.
   */
  pick(request: {
    id: string;
    refs: readonly string[];
  }): Promise<InspectorCommandResult>;
  cancelPick(request: { id: string }): Promise<InspectorCommandResult>;
}>;

/**
 * The state a client keeps after `incoming` arrives: the newer by revision,
 * and the one it holds when `incoming` is older or the same.
 */
export function mergeInspectorState(
  current: InspectorState | undefined,
  incoming: InspectorState
): InspectorState {
  return !current || incoming.revision > current.revision ? incoming : current;
}
