import type { JsonSchema } from "./contracts";
import { getPursueGoalTool, type GoalTool } from "./goalLoop";
import { getPageContextTool } from "./pageContext";
import {
  lookAtPageStateForDocument,
  type AriaRef,
  type PageStateCapture,
} from "./pageState";
import { listPublishedBrowserTools, listElementTools } from "./browserTools";
import {
  acceptedRefNodes,
  listCustomTools,
  type PublishedElementTool,
} from "./elementTools";
import { listCallerAwarePomTools, type CallerAwarePomTool } from "./registry";
import { RuntimeStateError } from "./errors";
import { listPeekTools, type PeekTool } from "./peek";

/**
 * A live tool: `execute` runs it as the calling agent, `executeAs` for the
 * caller given.
 */
export type PublishedTool =
  | CallerAwarePomTool
  | typeof getPageContextTool
  | PublishedElementTool
  | PeekTool
  | GoalTool;

/**
 * Where a live tool comes from: a Page Object (Page Object Tool), Ayme's
 * Browser Tools, the app's Custom Tools, the app's Peeks (Peek Tools), or the
 * agent's own tools (`snapshot`, `goal`). WebMCP never publishes a Peek Tool.
 */
export type PublishedToolGroup =
  "pageObject" | "browser" | "custom" | "peek" | "agent";

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

let publishedTools: readonly PublishedToolInfo[] = Object.freeze([]);

/**
 * The tools registered with WebMCP right now, in publication order. Empty
 * while publication is disabled, waiting, unavailable, failed or disposed.
 */
export function listPublishedTools(): readonly PublishedToolInfo[] {
  return publishedTools;
}

// The Peek Tools already warned about, so a clash is logged once.
const warnedClashes = new WeakSet<PeekTool>();

/**
 * Package-internal: every live tool by name: the tools WebMCP publication
 * registers and, when `peeks` is on, the Peek Tools after them. A Peek Tool
 * whose name a tool that came after it uses is left out with a console
 * warning, so a Peek never hides one of the app's tools; `ayme.peek` refuses
 * a clash that exists when it is called. Throws when two published tools
 * would share a name.
 */
export function resolveLiveTools({
  peeks,
}: {
  peeks: boolean;
}): Map<string, { tool: PublishedTool; group: PublishedToolGroup }> {
  const live = resolvePublishedTools();
  if (peeks)
    for (const tool of listPeekTools())
      if (!live.has(tool.name)) live.set(tool.name, { tool, group: "peek" });
      else if (!warnedClashes.has(tool)) {
        warnedClashes.add(tool);
        console.warn(
          `[ayme] ${tool.name} is hidden: another tool uses that name. Rename the Peek.`
        );
      }
  return live;
}

/**
 * Package-internal: every live tool, published or not, in publication order;
 * empty when a tool name clash leaves the set unresolvable.
 */
export function listLiveTools(options: {
  peeks: boolean;
}): readonly PublishedToolInfo[] {
  try {
    return toInfo([...resolveLiveTools(options).values()]);
  } catch {
    return Object.freeze([]);
  }
}

/**
 * Package-internal: the Peek Tools alone, the live tools of a Node process
 * of the app, which has no page.
 */
export function listPeekToolInfo(): readonly PublishedToolInfo[] {
  return toInfo(listPeekTools().map((tool) => ({ tool, group: "peek" })));
}

/**
 * The refs each live single-element tool can take in `capture` (a look at the current
 * page when absent), by tool name, in tree order: the same closed set the Goal
 * Loop offers for that tool's ref. Pass the look the Inspector shows,
 * so the refs match its structure.
 */
export async function listElementToolTargets(
  capture?: PageStateCapture
): Promise<Map<string, AriaRef[]>> {
  const elementTools = listElementTools();
  const current = capture ?? (await lookAtPageStateForDocument(document));
  return new Map(
    elementTools.map(({ tool, filter }) => [
      tool.name,
      acceptedRefNodes(filter, current).map((node) => node.ref),
    ])
  );
}

/** Package-internal: `synchronizeWebMcpTools` registered or withdrew tools. */
export function reportPublishedTools(
  tools: readonly {
    tool: PublishedTool;
    group: PublishedToolGroup;
  }[]
) {
  publishedTools = toInfo(tools);
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
