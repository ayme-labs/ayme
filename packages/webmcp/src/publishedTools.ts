import type { JsonSchema, RegisteredPomTool } from "./contracts";
import { getPursueGoalTool } from "./goalLoop";
import { getPageContextTool } from "./pageContext";
import { listRefTools, type PublishedRefTool } from "./refTools";
import { listRegisteredPomTools, subscribeToRegisteredPoms } from "./registry";
import { RuntimeStateError } from "./errors";

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

/** Every tool the runtime publishes to WebMCP, in publication order. */
export function listPublishedTools(): PublishedToolInfo[] {
  return [...resolvePublishedTools().values()].map(({ tool, group }) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    group,
  }));
}

const sessionSubscribers = new Set<() => void>();

/**
 * Call `subscriber` whenever the published set may have changed: when the
 * registered Page Objects change, and when a runtime session starts or stops.
 */
export function subscribeToPublishedTools(subscriber: () => void) {
  sessionSubscribers.add(subscriber);
  const unsubscribeFromPoms = subscribeToRegisteredPoms(subscriber);
  return () => {
    sessionSubscribers.delete(subscriber);
    unsubscribeFromPoms();
  };
}

/**
 * Package-internal: a runtime session configured or cleared its Ref Tools and
 * Goal Loop. Called by `start()` and `stop()` in `runtime.ts`.
 */
export function notifyPublishedToolsChanged() {
  for (const subscriber of sessionSubscribers) subscriber();
}
