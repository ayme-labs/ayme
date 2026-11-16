// The browser runtime's door to its tools: the sources of its document, and
// what reads the started session outside any Run. The resolution of the
// tools, which a Node host shares, is `toolResolution.ts`.
import { getPursueGoalTool } from "../goal-loop/infrastructure";
import { elementToolTargets } from "../tools/application";
import {
  listCustomTools,
  listElementTools,
  listPeekTools,
} from "../tools/infrastructure";
import {
  lookAtPageStateForDocument,
  pageOfDocument,
} from "../page-state/infrastructure";
import { type AriaRef, type PageStateCapture } from "../page-state/domain";
import { listRegisteredPomTools } from "../page-objects/infrastructure";
import { RuntimeStateError } from "../shared";
import {
  listPeekToolInfo as listPeekToolInfoFrom,
  listTools as listToolsFrom,
  resolveTools as resolveToolsFrom,
  startedPageOf,
  type ToolSources,
} from "./toolResolution";

export {
  configureStartedPageOf,
  type PublishedTool,
  type PublishedToolGroup,
  type PublishedToolInfo,
  type ToolInfo,
  type ToolSources,
} from "./toolResolution";

/** The browser runtime's tool sources: its document's. */
export const browserToolSources: ToolSources = {
  goalTool: () => getPursueGoalTool(),
  pomTools: () => listRegisteredPomTools(),
  customTools: () => listCustomTools(),
  peekTools: () => listPeekTools(),
};

/** Package-internal: the tools of the session, by name, from `sources` (the document's by default). */
export const resolveTools = (
  options: Parameters<typeof resolveToolsFrom>[0],
  sources: ToolSources = browserToolSources
) => resolveToolsFrom(options, sources);

/** Package-internal: the tools offered, with their availability, from `sources` (the document's by default). */
export const listTools = (
  options: Parameters<typeof listToolsFrom>[0],
  sources: ToolSources = browserToolSources
) => listToolsFrom(options, sources);

/** Package-internal: the Peek Tools alone, from `sources` (the document's by default). */
export const listPeekToolInfo = (
  sources: Pick<ToolSources, "peekTools"> = browserToolSources
) => listPeekToolInfoFrom(sources);

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
  const started = startedPageOf(pageOfDocument(document));
  if (!started)
    throw new RuntimeStateError("The Ayme browser runtime is not configured.");
  const elementTools = listElementTools();
  const current = capture ?? (await lookAtPageStateForDocument(document));
  return new Map(
    await Promise.all(
      elementTools.map(async (registered) => {
        const { nodes } = await elementToolTargets(
          registered,
          started,
          current
        );
        return [registered.tool.name, nodes.map(({ ref }) => ref)] as const;
      })
    )
  );
}
