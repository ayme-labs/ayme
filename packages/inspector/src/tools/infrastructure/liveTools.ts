import type { AymeWebMcpPublicationStatus, ToolInfo } from "@ayme-dev/ayme";
import type {
  AgentConnectionStatus,
  AppProcessTool,
} from "@ayme-dev/ayme/inspector";

import {
  inspectorClient,
  useInspectorState,
  type InspectorClient,
} from "../../shared";

/**
 * The tools the panel can run now, and how agents reach them: through the
 * Agent Connection and through WebMCP.
 */
export type LiveTools = Readonly<{
  /**
   * Every tool the session lists, in publication order: each one whose Page
   * Object or element is on the page, whether or not WebMCP has it. A tool
   * can be listed and unavailable (ADR-0035): `available` says whether a
   * call would run it, and `reason` why not. `publication` says whether
   * agents can call them.
   */
  live: readonly ToolInfo[];
  /**
   * The tools of the App Processes paired beside the page, which the
   * panel runs through the agent's Ayme MCP server: none while no server
   * is paired. An App Process offers Peek tools only, read in Node.
   */
  appProcess: readonly NodePeekTool[];
  /** WebMCP publication; a failure carries its error in `message`. */
  publication: AymeWebMcpPublicationStatus;
  /** Whether the page is connected to a coding agent's Ayme MCP server. */
  agentConnection: AgentConnectionStatus;
}>;

/** An App Process's tool, a Peek tool whose Peek lives in Node. */
export type NodePeekTool = ToolInfo & { group: "peek"; side: "node" };

// The App Processes' list as last read, and its tools as Node Peek tools,
// so the same list gives the same array.
let processTools: readonly AppProcessTool[] = Object.freeze([]);
let nodePeekTools: readonly NodePeekTool[] = Object.freeze([]);

function asNodePeekTools(tools: readonly AppProcessTool[]) {
  if (tools !== processTools) {
    processTools = tools;
    nodePeekTools = Object.freeze(
      tools.map(({ description, ...tool }) => ({
        ...tool,
        // An App Process's tool says what its author wrote, to agents too.
        authorDescription: description,
        agentDescription: description,
        inputSchema: tool.inputSchema as ToolInfo["inputSchema"],
        group: "peek" as const,
        side: "node" as const,
        available: true,
      }))
    );
  }
  return nodePeekTools;
}

let snapshot: LiveTools | undefined;

// The same object until something changes: the contract hands back the same
// lists and statuses until they change, so keep one set.
function liveToolsOf(client: InspectorClient): LiveTools {
  const state = client.current();
  const live = state.tools;
  const appProcess = asNodePeekTools(state.appProcessTools);
  const publication: AymeWebMcpPublicationStatus = state.publication;
  const agentConnection = state.agentConnection;
  if (
    snapshot?.live !== live ||
    snapshot.appProcess !== appProcess ||
    snapshot.publication !== publication ||
    snapshot.agentConnection !== agentConnection
  )
    snapshot = Object.freeze({
      live,
      appProcess,
      publication,
      agentConnection,
    });
  return snapshot;
}

/**
 * The live tools, the App Process tools, the publication status and the
 * Agent Connection status of the started session, read from the Inspector
 * contract and kept current: the runtime announces each change.
 */
export function useLiveTools(
  client: InspectorClient = inspectorClient()
): LiveTools {
  useInspectorState(client);
  return liveToolsOf(client);
}
