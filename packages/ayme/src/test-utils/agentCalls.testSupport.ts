/**
 * Test support: the calling agent's reads and Structural Ref actions, without
 * a runtime session or a WebMCP driver, and the Run context a test hands a
 * tool it executes itself.
 */
import type { Page } from "@playwright/test";
import type { ActionResult } from "../page-state";
import { getPageContextForDocument, listElementTools } from "../tools";
import {
  cursors,
  getPageStateForDocument,
  getPageStateSession,
  lookAtPageStateForDocument,
  type AriaRef,
  type Cursor,
  type PageStateSession,
} from "../page-state";
import { listRegisteredPomTargets, getPomDefinitions } from "../page-objects";
import { resolveTools } from "../runtime";
import { callers } from "../shared";
import type { RunContext } from "../runs";

/** The calling agent's cursor: a WebMCP agent's, as `webmcp` Runs read it. */
export const agentCursor = (): Cursor => cursors.of(callers.webmcp);

/** The page of a Run a test hands none: a tool acting on the page needs one. */
const NO_PAGE = {} as Page;

/**
 * The Run context for a tool a test executes itself, outside a runtime
 * session: it acts on `page`, its Change Record reads from and moves
 * `cursor`, the calling agent's by default, and the child Runs it starts
 * execute the available tool they name at once, unrecorded, on the same
 * page. Its Document is the test's own, none in Node; its Page State Session
 * is `pageStateSession`, else that Document's, read when a tool reaches it.
 */
export function runContext(
  page: Page = NO_PAGE,
  cursor: Cursor = agentCursor(),
  pageStateSession?: PageStateSession
): RunContext {
  return {
    cursor,
    page,
    document: globalThis.document,
    get pageStateSession() {
      return pageStateSession ?? getPageStateSession(globalThis.document);
    },
    run: async (name, input, childCursor = cursor) => {
      const entry = resolveTools({ peeks: true }).get(name);
      if (!entry?.available) throw new Error(`No available tool "${name}".`);
      return entry.tool.execute(
        input,
        runContext(page, childCursor, pageStateSession)
      );
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
  click: (page: Page, ref: AriaRef) =>
    browserTool("click").tool.execute(
      { target: ref },
      runContext(page)
    ) as Promise<ActionResult>,
  fill: (page: Page, ref: AriaRef, text: string) =>
    browserTool("fill").tool.execute(
      { target: ref, text },
      runContext(page)
    ) as Promise<ActionResult>,
};

/** A rooted test caller reads its instance's ref without moving its cursor. */
export async function rootRef(label: string): Promise<string> {
  const look = await lookAtPageStateForDocument(document);
  const root = (await listRegisteredPomTargets()).find(
    (target) => target.path === `${label}.@root`
  );
  const ref = [...look.elementsByRef].find(
    ([, element]) => element === root?.element
  )?.[0];
  if (!ref) throw new Error(`No root ref for ${label}.`);
  return ref;
}
