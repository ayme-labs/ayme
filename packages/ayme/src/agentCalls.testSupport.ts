/**
 * Test support: the calling agent's reads and Structural Ref actions, without
 * a runtime session or a WebMCP driver, and the Run context a test hands a
 * tool it executes itself.
 */
import type { ActionResult } from "./actionSequence";
import { listElementTools } from "./browserTools";
import type { Reader } from "./interactionHistory";
import { getPageContextForDocument } from "./pageContext";
import { getPageStateForDocument, type AriaRef } from "./pageState";
import { getPomDefinitions } from "./pomDefinitions";
import { resolveLiveTools, resolvePublishedTools } from "./publishedTools";
import { executeTopLevelRun, type RunContext } from "./run";

/**
 * The Run context for a tool a test executes itself, outside a runtime
 * session: its Change Record is `reader`'s, the agent's by default, and the
 * child Runs it starts execute the live tool they name at once, unrecorded.
 */
export function runContext(reader: Reader = "agent"): RunContext {
  return {
    reader,
    run: async (name, input, childReader = reader) => {
      const live = resolveLiveTools({ peeks: true }).get(name);
      if (!live) throw new Error(`No live tool "${name}".`);
      return live.tool.execute(input, runContext(childReader));
    },
  };
}

/**
 * The `run` a test hands `synchronizeWebMcpTools` outside a runtime session:
 * an agent's call runs the published tool for the agent, then `settle`, as a
 * `webmcp` Run does, but with no queue and unrecorded.
 */
export function runPublished(
  name: string,
  input: unknown,
  settle: () => Promise<void>
): Promise<unknown> {
  const published = resolvePublishedTools().get(name);
  if (!published) throw new Error(`No published tool "${name}".`);
  return executeTopLevelRun(published.tool, input, runContext(), settle);
}

function browserTool(name: string) {
  const tool = listElementTools().find(
    (candidate) => candidate.tool.name === name
  );
  if (!tool) throw new Error(`No Browser Tool "${name}".`);
  return tool;
}

export const ayme = {
  getPageContext: (...names: readonly string[]) =>
    getPageContextForDocument(document, ...names),
  getPageState: () => getPageStateForDocument(document),
  getPomDefinitions,
  click: (ref: AriaRef) =>
    browserTool("click").tool.execute(
      { target: ref },
      runContext()
    ) as Promise<ActionResult>,
  fill: (ref: AriaRef, text: string) =>
    browserTool("fill").tool.execute(
      { target: ref, text },
      runContext()
    ) as Promise<ActionResult>,
};
