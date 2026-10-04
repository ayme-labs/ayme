import type { JsonSchema } from "./contracts";
import { getPursueGoalTool, type GoalTool } from "./goalLoop";
import { getPageContextTool } from "./pageContext";
import {
  peekPageStateForDocument,
  type AriaRef,
  type PageStateCapture,
} from "./pageState";
import { listPublishedBrowserTools, listElementTools } from "./browserTools";
import {
  acceptedRefNodes,
  listCustomTools,
  type PublishedElementTool,
} from "./elementTools";
import {
  listCallerAwarePomTools,
  subscribeToRegisteredPoms,
  type CallerAwarePomTool,
} from "./registry";
import { RuntimeStateError } from "./errors";
import type { AymeWebMcpPublicationStatus } from "./runtime";

/**
 * A live tool: `execute` runs it as the calling agent, `executeAs` for the
 * caller given.
 */
export type PublishedTool =
  | CallerAwarePomTool
  | typeof getPageContextTool
  | PublishedElementTool
  | GoalTool;

/**
 * Where a published tool comes from: a Page Object (Page Object Tool), Ayme's
 * Browser Tools, the app's Custom Tools, or the agent's own tools
 * (`snapshot`, `goal`).
 */
export type PublishedToolGroup = "pageObject" | "browser" | "custom" | "agent";

/** A published tool as an agent sees it, for reading only. */
export type PublishedToolInfo = Readonly<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
  group: PublishedToolGroup;
}>;

/**
 * Package-internal: the tools WebMCP publication registers, by name, in
 * publication order. Throws when two published tools would share a name.
 */
export function resolvePublishedTools(): Map<
  string,
  { tool: PublishedTool; group: PublishedToolGroup }
> {
  const pursueGoal = getPursueGoalTool();
  const pomTools = listCallerAwarePomTools();
  const active = new Map<
    string,
    { tool: PublishedTool; group: PublishedToolGroup }
  >([[getPageContextTool.name, { tool: getPageContextTool, group: "agent" }]]);
  const takenElsewhere = new Set([
    ...pomTools.map((tool) => tool.name),
    ...(pursueGoal ? [pursueGoal.name] : []),
  ]);
  const ownTools = [
    ...listPublishedBrowserTools().map((tool) => ({
      tool,
      group: "browser" as const,
    })),
    ...listCustomTools().map(({ tool }) => ({
      tool,
      group: "custom" as const,
    })),
  ];
  for (const { tool, group } of ownTools) {
    if (active.has(tool.name) || takenElsewhere.has(tool.name))
      throw new RuntimeStateError(
        `Cannot publish the tool "${tool.name}": another published tool already uses that name.`
      );
    active.set(tool.name, { tool, group });
  }
  for (const tool of pomTools)
    active.set(tool.name, { tool, group: "pageObject" });
  if (pursueGoal)
    active.set(pursueGoal.name, { tool: pursueGoal, group: "agent" });
  return active;
}

type PublicationReadModel = {
  status: AymeWebMcpPublicationStatus;
  tools: readonly PublishedToolInfo[];
};

const NO_SESSION: AymeWebMcpPublicationStatus = Object.freeze({
  state: "disposed",
  message: "No Ayme runtime session has started.",
});

const readModel: PublicationReadModel = {
  status: NO_SESSION,
  tools: Object.freeze([]),
};
const subscribers = new Set<() => void>();

function notify() {
  for (const subscriber of subscribers) subscriber();
}

/**
 * The tools registered with WebMCP right now, in publication order. Empty
 * while publication is disabled, waiting, unavailable, failed or disposed.
 */
export function listPublishedTools(): readonly PublishedToolInfo[] {
  return readModel.tools;
}

let liveTools: { key: string; tools: readonly PublishedToolInfo[] } = {
  key: "[]",
  tools: Object.freeze([]),
};

/**
 * Every live tool, published or not, in publication order: each tool
 * `runTool` can run now. The same array comes back
 * until the set changes (for `useSyncExternalStore`); subscribe with
 * `subscribeToPublishedTools`. Empty when a tool name clash leaves the
 * set unresolvable; `runTool` then rejects with that error, and an active
 * publication reports it as its failed status.
 */
export function listLiveTools(): readonly PublishedToolInfo[] {
  const tools = describeLiveTools();
  const key = JSON.stringify(tools);
  if (key !== liveTools.key) liveTools = { key, tools };
  return liveTools.tools;
}

/**
 * Package-internal: every live tool, described, in publication order; empty
 * when a tool name clash leaves the set unresolvable.
 */
export function describeLiveTools(): readonly PublishedToolInfo[] {
  try {
    return toInfo([...resolvePublishedTools().values()]);
  } catch {
    return Object.freeze([]);
  }
}

/**
 * The runtime session's WebMCP publication status. A failed publication's
 * `message` carries its error.
 */
export function getPublicationStatus(): AymeWebMcpPublicationStatus {
  return readModel.status;
}

/**
 * The refs each live single-element tool can take in `capture` (a peek of the current
 * page when absent), by tool name, in tree order: the same closed set the Goal
 * Loop offers for that tool's ref. Pass the peek the Inspector shows,
 * so the refs match its structure.
 */
export async function listElementToolTargets(
  capture?: PageStateCapture
): Promise<Map<string, AriaRef[]>> {
  const elementTools = listElementTools();
  const current = capture ?? (await peekPageStateForDocument(document));
  return new Map(
    elementTools.map(({ tool, filter }) => [
      tool.name,
      acceptedRefNodes(filter, current).map((node) => node.ref),
    ])
  );
}

/**
 * Call `subscriber` whenever the published or live tools or the status may
 * have changed: a publication pass, a status change (a session starting or
 * stopping sets its Custom Tools and Goal Loop), or a Page Object change.
 */
export function subscribeToPublishedTools(subscriber: () => void) {
  subscribers.add(subscriber);
  const unsubscribeFromPoms = subscribeToRegisteredPoms(subscriber);
  return () => {
    subscribers.delete(subscriber);
    unsubscribeFromPoms();
  };
}

/** Package-internal: `synchronizeWebMcpTools` registered or withdrew tools. */
export function reportPublishedTools(
  tools: readonly {
    tool: PublishedTool;
    group: PublishedToolGroup;
  }[]
) {
  readModel.tools = toInfo(tools);
  notify();
}

function toInfo(
  tools: readonly { tool: PublishedTool; group: PublishedToolGroup }[]
): readonly PublishedToolInfo[] {
  return Object.freeze(
    tools.map(({ tool, group }) =>
      Object.freeze({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        group,
      })
    )
  );
}

/** Package-internal: the runtime session's publication status changed. */
export function reportPublicationStatus(status: AymeWebMcpPublicationStatus) {
  readModel.status = status;
  notify();
}
