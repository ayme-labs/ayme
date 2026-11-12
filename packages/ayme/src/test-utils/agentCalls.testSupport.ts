/**
 * Test support: the calling agent's reads and Structural Ref actions, without
 * a runtime session or a WebMCP driver, and the Run context a test hands a
 * tool it executes itself.
 */
import type { Page } from "@playwright/test";
import type { ActionResult } from "../page-state/domain";
import { getPageContextForDocument } from "../tools/infrastructure";
import { listElementTools, routerNavigate } from "../tools/infrastructure";
import {
  cursors,
  documentNavigation,
  getPageStateForDocument,
  getPageStateSession,
  lookAtPageStateForDocument,
  pageOfDocument,
} from "../page-state/infrastructure";
import { inPage } from "../in-page";
import { type AriaRef, type Cursor } from "../page-state/domain";
import { type PageStateSession, type Reach } from "../page-state/application";
import {
  listRegisteredPomTargets,
  getPomDefinitions,
  createPage,
  pageObjectIdsOf,
} from "../page-objects/infrastructure";
import type { PageObjectId } from "../page-objects/domain";
import { resolveTools, sessionReach } from "../runtime";
import { callers } from "../shared";
import type { RunContext } from "../runs/application";

/** The calling agent's cursor: a WebMCP agent's, as `webmcp` Runs read it. */
export const agentCursor = (): Cursor => cursors.of(callers.webmcp);

/**
 * The page of a Run a test hands none: a tool acting on the page needs one,
 * which in a browser is the document's own page. It is made on first use. A
 * unit test has no browser to make one in, and its locators are stand-ins
 * that answer for themselves: the page then only binds to nothing.
 */
const defaultPage = (): Page => {
  let page: Page | undefined;
  const made = () => {
    try {
      return (page ??= createPage() as Page);
    } catch {
      return (page ??= { exposeFunction: async () => {} } as unknown as Page);
    }
  };
  return new Proxy({} as Page, {
    get: (_, property) => Reflect.get(made(), property),
  });
};

/**
 * The Run context for a tool a test executes itself, outside a runtime
 * session: it acts on `page`, its Change Record reads from and moves
 * `cursor`, the calling agent's by default, and the child Runs it starts
 * execute the available tool they name at once, unrecorded, on the same
 * page. Its Document is the test's own, none in Node; its Page State Session
 * is `pageStateSession`, else that Document's, read when a tool reaches it.
 * It measures reach with `reach`, else as a session the test handed none
 * would: a unit test, which has no layout, hands `alwaysReaches()`.
 */
export function runContext(
  page: Page = defaultPage(),
  cursor: Cursor = agentCursor(),
  pageStateSession?: PageStateSession,
  reach: Reach = sessionReach()
): RunContext {
  return {
    cursor,
    page,
    navigation: documentNavigation(globalThis.document),
    ...(routerNavigate() ? { routerNavigate: routerNavigate() } : {}),
    pomDefinitions: getPomDefinitions,
    get pageStateSession() {
      return pageStateSession ?? getPageStateSession(globalThis.document);
    },
    reach,
    run: async (name, input, childCursor = cursor) => {
      const entry = resolveTools({ peeks: true }).get(name);
      if (!entry?.available) throw new Error(`No available tool "${name}".`);
      return entry.tool.execute(
        input,
        runContext(page, childCursor, pageStateSession, reach)
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
  click: (page: Page, ref: AriaRef, reach?: Reach) =>
    browserTool("click").tool.execute(
      { target: ref },
      runContext(page, undefined, undefined, reach)
    ) as Promise<ActionResult>,
  fill: (page: Page, ref: AriaRef, text: string, reach?: Reach) =>
    browserTool("fill").tool.execute(
      { target: ref, text },
      runContext(page, undefined, undefined, reach)
    ) as Promise<ActionResult>,
};

/** A rooted test caller reads its instance's ref without moving its cursor. */
export async function rootRef(label: string): Promise<string> {
  // A look names the root as a capture would, which the probe may not have.
  await lookAtPageStateForDocument(document);
  const root = (await listRegisteredPomTargets()).find(
    (target) => target.path === `${label}.@root`
  );
  const [ref] = root
    ? await inPage(pageOfDocument(document)).currentRefs([root.ref])
    : [];
  if (!ref) throw new Error(`No root ref for ${label}.`);
  return ref;
}

/** A rooted test caller reads its instance's Page Object id without moving its cursor. */
export async function rootId(label: string): Promise<PageObjectId> {
  const [id] = await pageObjectIdsOf([await rootRef(label)]);
  if (!id) throw new Error(`No Page Object id for ${label}.`);
  return id;
}
