/**
 * Test support: the calling agent's reads and Structural Ref actions, without
 * a runtime session or a WebMCP driver.
 */
import type { ActionResult } from "./actionSequence";
import { listElementTools } from "./browserTools";
import { getPageContextForDocument } from "./pageContext";
import { getPageStateForDocument, type AriaRef } from "./pageState";
import { getPomDefinitions } from "./pomDefinitions";

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
    browserTool("click").tool.execute({ target: ref }) as Promise<ActionResult>,
  fill: (ref: AriaRef, text: string) =>
    browserTool("fill").tool.execute({
      target: ref,
      text,
    }) as Promise<ActionResult>,
};
