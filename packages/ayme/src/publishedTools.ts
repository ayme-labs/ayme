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
 * A tool of the session: `execute` runs it for a Run, whose context carries
 * the cursor its Change Record reads from and moves.
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
 * agent's own tools (`snapshot`, `goal`).
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
 * the component instance it acts on) is and its action's availability
 * predicate, if it has one, holds; every other tool always is. `reason`,
 * when the tool is unavailable and there is one, is its Availability Reason:
 * the runtime's, naming the Structural Ref of the element a click would
 * reach instead, or the predicate's string (ADR-0035).
 */
export type ToolInfo = PublishedToolInfo &
  Readonly<{ available: boolean; reason?: string }>;

type ResolvedTool = {
  tool: PublishedTool;
  group: PublishedToolGroup;
  /** Whether it is offered: a Page Object Tool's Page Object is present. */
  present: boolean;
  available: boolean;
  reason?: string;
};

/**
 * Every registered tool but the Peek Tools, by name, in publication order.
 * Throws when two of them would share a name.
 */
/** What every tool but a Page Object Tool is: on the page, and callable. */
const always = { present: true, available: true };

function resolveRegisteredTools(): Map<string, ResolvedTool> {
  const pursueGoal = getPursueGoalTool();
  const pomTools = listRegisteredPomTools();
  const tools = new Map<string, ResolvedTool>([
    [
      getPageContextTool.name,
      { tool: getPageContextTool, group: "agent", ...always },
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
    tools.set(tool.name, { tool, group, ...always });
  }
  for (const { tool, ...availability } of pomTools)
    tools.set(tool.name, { tool, group: "pageObject", ...availability });
  if (pursueGoal)
    tools.set(pursueGoal.name, { tool: pursueGoal, group: "agent", ...always });
  return tools;
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
        tools.set(tool.name, { tool, group: "peek", ...always });
      else if (!warnedClashes.has(tool)) {
        warnedClashes.add(tool);
        console.warn(
          `[ayme] ${tool.name} is hidden: another tool uses that name. Rename the Peek.`
        );
      }
  return tools;
}

/**
 * Package-internal: every tool of the session that is offered, with its
 * availability, in publication order: a Page Object Tool while its Page
 * Object is present, available or not (ADR-0035); empty when a tool name
 * clash leaves the set unresolvable.
 */
export function listTools(options: { peeks: boolean }): readonly ToolInfo[] {
  try {
    return toInfo(
      [...resolveTools(options).values()].filter(({ present }) => present)
    );
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
    listPeekTools().map((tool) => ({ tool, group: "peek", ...always }))
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

/** Each tool's reading. */
function toInfo(tools: readonly ResolvedTool[]): readonly ToolInfo[] {
  return Object.freeze(
    tools.map(({ tool, group, available, reason }) =>
      Object.freeze({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        group,
        available,
        ...(reason === undefined ? {} : { reason }),
      })
    )
  );
}
