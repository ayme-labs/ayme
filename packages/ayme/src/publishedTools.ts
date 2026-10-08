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
import { listRegisteredPomTools, type CallerAwarePomTool } from "./registry";
import { RuntimeStateError } from "./errors";
import { listPeekTools, type PeekTool } from "./peek";

/**
 * A tool of the session: `execute` runs it as the calling agent, `executeAs`
 * for the caller given.
 */
export type PublishedTool =
  | CallerAwarePomTool
  | typeof getPageContextTool
  | PublishedElementTool
  | PeekTool
  | GoalTool;

/**
 * Where a tool comes from: a Page Object (Page Object Tool), Ayme's
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
 * A tool of the session, for reading only. `available` says whether a call
 * can run it now: a Page Object Tool is available while its Page Object (or
 * the component instance it acts on) is; every other tool always is.
 */
export type ToolInfo = PublishedToolInfo & Readonly<{ available: boolean }>;

type ResolvedTool = {
  tool: PublishedTool;
  group: PublishedToolGroup;
  available: boolean;
};

/**
 * Every registered tool but the Peek Tools, by name, in publication order.
 * Throws when two of them would share a name.
 */
function resolveRegisteredTools(): Map<string, ResolvedTool> {
  const pursueGoal = getPursueGoalTool();
  const pomTools = listRegisteredPomTools();
  const tools = new Map<string, ResolvedTool>([
    [
      getPageContextTool.name,
      { tool: getPageContextTool, group: "agent", available: true },
    ],
  ]);
  const takenElsewhere = new Set([
    ...pomTools.map(({ tool }) => tool.name),
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
    if (tools.has(tool.name) || takenElsewhere.has(tool.name))
      throw new RuntimeStateError(
        `Cannot publish the tool "${tool.name}": another published tool already uses that name.`
      );
    tools.set(tool.name, { tool, group, available: true });
  }
  for (const { tool, available } of pomTools)
    tools.set(tool.name, { tool, group: "pageObject", available });
  if (pursueGoal)
    tools.set(pursueGoal.name, {
      tool: pursueGoal,
      group: "agent",
      available: true,
    });
  return tools;
}

/**
 * Package-internal: the tools WebMCP publication registers, by name, in
 * publication order: the available ones. Throws when two registered tools
 * would share a name.
 */
export function resolvePublishedTools(): Map<
  string,
  { tool: PublishedTool; group: PublishedToolGroup }
> {
  return new Map(
    [...resolveRegisteredTools()].flatMap(
      ([name, { tool, group, available }]) =>
        available ? [[name, { tool, group }] as const] : []
    )
  );
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
 * Package-internal: every tool of the session by name, available or not:
 * the registered tools and, when `peeks` is on, the Peek Tools after them.
 * A Peek Tool whose name a tool that came after it uses is left out with a
 * console warning, so a Peek never hides one of the app's tools;
 * `ayme.peek` refuses a clash that exists when it is called. Throws when two
 * registered tools would share a name.
 */
export function resolveTools({
  peeks,
}: {
  peeks: boolean;
}): Map<string, ResolvedTool> {
  const tools = resolveRegisteredTools();
  if (peeks)
    for (const tool of listPeekTools())
      if (!tools.has(tool.name))
        tools.set(tool.name, { tool, group: "peek", available: true });
      else if (!warnedClashes.has(tool)) {
        warnedClashes.add(tool);
        console.warn(
          `[ayme] ${tool.name} is hidden: another tool uses that name. Rename the Peek.`
        );
      }
  return tools;
}

/**
 * Package-internal: every tool of the session with its availability, in
 * publication order; empty when a tool name clash leaves the set
 * unresolvable.
 */
export function listTools(options: { peeks: boolean }): readonly ToolInfo[] {
  try {
    return toInfo([...resolveTools(options).values()]);
  } catch {
    return Object.freeze([]);
  }
}

/**
 * Package-internal: the Peek Tools alone, the tools of a Node process of the
 * app, which has no page.
 */
export function listPeekToolInfo(): readonly ToolInfo[] {
  return toInfo(
    listPeekTools().map((tool) => ({ tool, group: "peek", available: true }))
  );
}

/**
 * The refs each available single-element tool can take in `capture` (a look at the current
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

/** Each tool's reading, with its availability when it has one. */
function toInfo(tools: readonly ResolvedTool[]): readonly ToolInfo[];
function toInfo(
  tools: readonly { tool: PublishedTool; group: PublishedToolGroup }[]
): readonly PublishedToolInfo[];
function toInfo(
  tools: readonly {
    tool: PublishedTool;
    group: PublishedToolGroup;
    available?: boolean;
  }[]
) {
  return Object.freeze(
    tools.map(({ tool, group, available }) =>
      Object.freeze({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        group,
        ...(available === undefined ? {} : { available }),
      })
    )
  );
}
