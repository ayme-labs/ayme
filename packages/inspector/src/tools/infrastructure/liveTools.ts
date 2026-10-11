import { useSyncExternalStore } from "react";

import type {
  Ayme,
  AymeWebMcpPublicationStatus,
  ToolInfo,
} from "@ayme-dev/ayme";
import {
  getAgentConnectionStatus,
  getAppProcessTools,
  getStartedAyme,
  subscribeToStartedAyme,
  type AgentConnectionStatus,
  type AppProcessTool,
} from "@ayme-dev/ayme/internal";

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

const NO_TOOLS: readonly ToolInfo[] = Object.freeze([]);
const NO_PROCESS_TOOLS: readonly AppProcessTool[] = Object.freeze([]);

// The App Processes' list as last read, and its tools as Node Peek tools,
// so the same list gives the same array.
let processTools: readonly AppProcessTool[] = NO_PROCESS_TOOLS;
let nodePeekTools: readonly NodePeekTool[] = Object.freeze([]);

function asNodePeekTools(tools: readonly AppProcessTool[]) {
  if (tools !== processTools) {
    processTools = tools;
    nodePeekTools = Object.freeze(
      tools.map((tool) => ({
        ...tool,
        inputSchema: tool.inputSchema as ToolInfo["inputSchema"],
        group: "peek" as const,
        side: "node" as const,
        available: true,
      }))
    );
  }
  return nodePeekTools;
}
const NO_SESSION: AymeWebMcpPublicationStatus = Object.freeze({
  state: "disposed",
  message: "No Ayme runtime session has started.",
});
const NO_AGENT_CONNECTION: AgentConnectionStatus = Object.freeze({
  state: "off",
});

let snapshot: LiveTools | undefined;

// useSyncExternalStore needs the same object until something changes: the
// session hands back the same list and status until they change, so keep one
// pair.
function readLiveTools(): LiveTools {
  const ayme = getStartedAyme();
  const live = ayme?.tools.list() ?? NO_TOOLS;
  const appProcess = asNodePeekTools(
    ayme ? getAppProcessTools(ayme).list() : NO_PROCESS_TOOLS
  );
  const publication = ayme?.webMCP.publicationStatus ?? NO_SESSION;
  const agentConnection = ayme
    ? getAgentConnectionStatus(ayme).get()
    : NO_AGENT_CONNECTION;
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
 * Follow the started session's tools, its App Process tools, its
 * publication and its Agent Connection, across sessions.
 */
function subscribe(onChange: () => void) {
  let unsubscribeFromSession = () => {};
  const follow = (ayme: Ayme | undefined) => {
    unsubscribeFromSession();
    if (!ayme) {
      unsubscribeFromSession = () => {};
      return;
    }
    const unsubscribeFromTools = ayme.tools.subscribe(onChange);
    const unsubscribeFromStatus = ayme.webMCP.subscribe(onChange);
    const unsubscribeFromProcesses =
      getAppProcessTools(ayme).subscribe(onChange);
    const unsubscribeFromConnection =
      getAgentConnectionStatus(ayme).subscribe(onChange);
    unsubscribeFromSession = () => {
      unsubscribeFromTools();
      unsubscribeFromStatus();
      unsubscribeFromProcesses();
      unsubscribeFromConnection();
    };
  };
  const unsubscribeFromStarted = subscribeToStartedAyme((ayme) => {
    follow(ayme);
    onChange();
  });
  follow(getStartedAyme());
  return () => {
    unsubscribeFromStarted();
    unsubscribeFromSession();
  };
}

/**
 * The live tools, the App Process tools, the publication status and the
 * Agent Connection status of the started session, kept current: the
 * session announces each change.
 */
export function useLiveTools(): LiveTools {
  return useSyncExternalStore(subscribe, readLiveTools);
}
