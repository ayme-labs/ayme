import type { JsonSchema } from "../shared";
import { getPursueGoalTool } from "../goal-loop/infrastructure";
import { type GoalTool } from "../goal-loop/application";
import {
  acceptedRefNodes,
  getPageContextTool,
  type PeekTool,
  type PublishedElementTool,
  type ReachOn,
} from "../tools/application";
import {
  listCustomTools,
  listElementTools,
  listPeekTools,
  listPublishedBrowserTools,
} from "../tools/infrastructure";
import { lookAtPageStateForDocument } from "../page-state/infrastructure";
import { type AriaRef, type PageStateCapture } from "../page-state/domain";
import { listRegisteredPomTools } from "../page-objects/infrastructure";
import { type CallerAwarePomTool } from "../page-objects/application";
import type { ToolAvailability } from "../page-state/domain";
import { RuntimeStateError } from "../shared";

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

/** A tool, offered while `present`: a Page Object Tool's Page Object is. */
type ResolvedTool = {
  tool: PublishedTool;
  group: PublishedToolGroup;
} & ToolAvailability;

/** What every tool but a Page Object Tool is: on the page, and callable. */
const always = (): Pick<ResolvedTool, "present" | "available"> => ({
  present: true,
  available: true,
});

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
      { tool: getPageContextTool, group: "agent", ...always() },
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
    tools.set(tool.name, { tool, group, ...always() });
  }
  for (const { tool, ...availability } of pomTools)
    tools.set(tool.name, { tool, group: "pageObject", ...availability });
  if (pursueGoal)
    tools.set(pursueGoal.name, {
      tool: pursueGoal,
      group: "agent",
      ...always(),
    });
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
        tools.set(tool.name, { tool, group: "peek", ...always() });
      else if (!warnedClashes.has(tool)) {
        warnedClashes.add(tool);
        console.warn(
          `[ayme] ${tool.name} is hidden: another tool uses that name.`
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
    listPeekTools().map((tool) => ({ tool, group: "peek", ...always() }))
  );
}

// The started session's page and the Reach it picked, for what reads them
// outside any Run: the Inspector's element tool targets. A Run is handed
// its own instead.
let startedPage: ReachOn | undefined;

/**
 * Package-internal: store or clear the started session's page and Reach.
 * Called by `start()` and `stop()`.
 */
export function configureStartedPage(started: ReachOn | undefined): void {
  startedPage = started;
}

/**
 * The refs each available single-element tool can take in `capture` (a look at the current
 * page when absent), by tool name, in tree order: the same closed set the Goal
 * Loop offers for that tool's ref. Pass the look the Inspector shows,
 * so the refs match its structure. Reach is measured on the started
 * session's page, with the Reach it picked.
 */
export async function listElementToolTargets(
  capture?: PageStateCapture
): Promise<Map<string, AriaRef[]>> {
  const started = startedPage;
  if (!started)
    throw new RuntimeStateError("The Ayme browser runtime is not configured.");
  const elementTools = listElementTools();
  const current = capture ?? (await lookAtPageStateForDocument(document));
  return started.reach.inReachBatch(
    () =>
      new Map(
        elementTools.map(({ tool, filter }) => [
          tool.name,
          acceptedRefNodes(
            started.reach,
            (element) => filter(element, started),
            current
          ).map((node) => node.ref),
        ])
      )
  );
}

/** A tool's two descriptions: a tool that is not a Page Object Tool's are its own. */
function descriptionsOf(
  tool: PublishedTool
): Pick<PublishedToolInfo, "authorDescription" | "agentDescription"> {
  if ("className" in tool)
    return {
      ...(tool.authorDescription === undefined
        ? {}
        : { authorDescription: tool.authorDescription }),
      ...(tool.agentDescription === undefined
        ? {}
        : { agentDescription: tool.agentDescription }),
    };
  return {
    authorDescription: tool.description,
    agentDescription: tool.description,
  };
}

/** Each tool's reading. */
function toInfo(tools: readonly ResolvedTool[]): readonly ToolInfo[] {
  return Object.freeze(
    tools.map(({ tool, group, available, reason }) =>
      Object.freeze({
        name: tool.name,
        ...("className" in tool ? { className: tool.className } : {}),
        ...descriptionsOf(tool),
        ...("returnPoms" in tool && tool.returnPoms
          ? {
              returnPoms: tool.returnPoms,
            }
          : {}),
        inputSchema: tool.inputSchema,
        group,
        available,
        ...(reason === undefined ? {} : { reason }),
      })
    )
  );
}
