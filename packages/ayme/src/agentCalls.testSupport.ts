/**
 * Test support: the calling agent's reads and Structural Ref actions, without
 * a runtime session or a WebMCP driver, and the Run context a test hands a
 * tool it executes itself.
 */
import type { ActionResult } from "./actionSequence";
import { listElementTools } from "./browserTools";
import { cursors, type Cursor } from "./cursors";
import { getPageContextForDocument } from "./pageContext";
import { getPageStateForDocument, type AriaRef } from "./pageState";
import { getPomDefinitions } from "./pomDefinitions";
import { resolveTools } from "./publishedTools";
import { callers, type RunContext } from "./run";

/** The calling agent's cursor: a WebMCP agent's, as `webmcp` Runs read it. */
export const agentCursor = (): Cursor => cursors.of(callers.webmcp);

/**
 * The Run context for a tool a test executes itself, outside a runtime
 * session: its Change Record reads from and moves `cursor`, the calling
 * agent's by default, and the child Runs it starts execute the available
 * tool they name at once, unrecorded.
 */
export function runContext(cursor: Cursor = agentCursor()): RunContext {
  return {
    cursor,
    run: async (name, input, childCursor = cursor) => {
      const entry = resolveTools({ peeks: true }).get(name);
      if (!entry?.available) throw new Error(`No available tool "${name}".`);
      return entry.tool.execute(input, runContext(childCursor));
    },
  };
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
    getPageContextForDocument(document, agentCursor(), ...names),
  getPageState: () => getPageStateForDocument(document, agentCursor()),
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
