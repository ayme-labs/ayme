import type { JsonSchema, RegisteredPomTool } from "./contracts";
import { getPursueGoalTool } from "./goalLoop";
import { getPageContextTool } from "./pageContext";
import { listRefTools, type PublishedRefTool } from "./refTools";
import { listRegisteredPomTools } from "./registry";
import { RuntimeStateError } from "./errors";
import type { AymeWebMcpPublicationStatus } from "./runtime";

export type PublishedTool =
  RegisteredPomTool | typeof getPageContextTool | PublishedRefTool;

/**
 * Where a published tool comes from: a Page Object (Generated WebMCP Tool), a
 * Ref Tool, or the agent's own tools (`get_page_context`, `pursue_goal`).
 */
export type PublishedToolGroup = "pageObject" | "ref" | "agent";

/** A published tool as an agent sees it, for reading only. */
export type PublishedToolInfo = Readonly<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
  group: PublishedToolGroup;
}>;

/**
 * Package-internal: the tools WebMCP publication registers, by name, in
 * publication order. Throws when a Ref Tool takes a name another published
 * tool uses.
 */
export function resolvePublishedTools(): Map<
  string,
  { tool: PublishedTool; group: PublishedToolGroup }
> {
  const pursueGoal = getPursueGoalTool();
  const pomTools = listRegisteredPomTools();
  const active = new Map<
    string,
    { tool: PublishedTool; group: PublishedToolGroup }
  >([[getPageContextTool.name, { tool: getPageContextTool, group: "agent" }]]);
  const takenElsewhere = new Set([
    ...pomTools.map((tool) => tool.name),
    ...(pursueGoal ? [pursueGoal.name] : []),
  ]);
  for (const { tool } of listRefTools()) {
    if (active.has(tool.name) || takenElsewhere.has(tool.name))
      throw new RuntimeStateError(
        `Cannot publish the Ref Tool "${tool.name}": another published tool already uses that name.`
      );
    active.set(tool.name, { tool, group: "ref" });
  }
  for (const tool of pomTools)
    active.set(tool.name, { tool, group: "pageObject" });
  if (pursueGoal)
    active.set(pursueGoal.name, {
      tool: pursueGoal as PublishedTool,
      group: "agent",
    });
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

/**
 * The runtime session's WebMCP publication status. A failed publication's
 * `message` carries its error.
 */
export function getPublicationStatus(): AymeWebMcpPublicationStatus {
  return readModel.status;
}

/** Call `subscriber` whenever the published tools or the status change. */
export function subscribeToPublishedTools(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

/** Package-internal: `synchronizeWebMcpTools` registered or withdrew tools. */
export function reportPublishedTools(
  tools: readonly { tool: PublishedTool; group: PublishedToolGroup }[]
) {
  readModel.tools = Object.freeze(
    tools.map(({ tool, group }) =>
      Object.freeze({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        group,
      })
    )
  );
  notify();
}

/** Package-internal: the runtime session's publication status changed. */
export function reportPublicationStatus(status: AymeWebMcpPublicationStatus) {
  readModel.status = status;
  notify();
}
