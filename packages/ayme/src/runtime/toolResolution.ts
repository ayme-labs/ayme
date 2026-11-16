import type { Page } from "@playwright/test";
import type {
  PublishedToolGroup,
  PublishedToolInfo,
  ToolInfo,
} from "../shared";

export type { PublishedToolGroup, PublishedToolInfo, ToolInfo };
import { type GoalTool } from "../goal-loop/application";
import {
  getPageContextTool,
  type PeekTool,
  type PublishedElementTool,
  type RegisteredElementTool,
  type ReachOn,
} from "../tools/application";
import { listPublishedBrowserTools } from "../tools/infrastructure";
import type { listRegisteredPomTools } from "../page-objects/infrastructure";
import { RuntimeStateError } from "../shared";
import { type CallerAwarePomTool } from "../page-objects/application";
import type { ToolAvailability } from "../page-state/domain";

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
 * Where a session's tools come from: its Goal Loop, its page's Page Objects,
 * its Custom Tools and its Peeks. The browser runtime's are its document's;
 * a Node host's are those of the Page it was handed.
 */
export type ToolSources = {
  goalTool(): GoalTool | null;
  pomTools(): ReturnType<typeof listRegisteredPomTools>;
  customTools(): readonly RegisteredElementTool[];
  peekTools(): PeekTool[];
};

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
function resolveRegisteredTools(
  sources: ToolSources
): Map<string, ResolvedTool> {
  const pursueGoal = sources.goalTool();
  const pomTools = sources.pomTools();
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
    ...sources.customTools().map(({ tool }) => ({
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
export function resolveTools(
  { peeks }: { peeks: boolean },
  sources: ToolSources
): Map<string, ResolvedTool> {
  const tools = resolveRegisteredTools(sources);
  if (peeks)
    for (const tool of sources.peekTools())
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
export function listTools(
  options: { peeks: boolean },
  sources: ToolSources
): readonly ToolInfo[] {
  try {
    return toInfo(
      [...resolveTools(options, sources).values()].filter(
        ({ present }) => present
      )
    );
  } catch {
    return Object.freeze([]);
  }
}

/**
 * Package-internal: the Peek Tools alone, the tools of a Node process of the
 * app, which has no page.
 */
export function listPeekToolInfo(
  sources: Pick<ToolSources, "peekTools">
): readonly ToolInfo[] {
  return toInfo(
    sources.peekTools().map((tool) => ({ tool, group: "peek", ...always() }))
  );
}

// The started session's page and the Reach it picked, for what reads them
// outside any Run: the Inspector's element tool targets. A Run is handed
// its own instead. Kept per Page (ADR-0049).
const startedPages = new WeakMap<Page, ReachOn>();

/** Package-internal: the page and Reach of the session started on `key`, if any. */
export function startedPageOf(key: Page): ReachOn | undefined {
  return startedPages.get(key);
}

/**
 * Package-internal: store or clear the page and Reach of the session started
 * on `key`. Called by `start()` and `stop()`.
 */
export function configureStartedPageOf(
  key: Page,
  started: ReachOn | undefined
): void {
  if (started) startedPages.set(key, started);
  else startedPages.delete(key);
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
