// Stands in the browser runtime's host of its in-page module
// (page-state/infrastructure/browserInPage.ts) where no browser lays the
// page out, as in jsdom: a capture runs the module's own ref world over the
// dual capture a test gives, in place of Playwright's, and an action waits
// for a Settled Page with core's wait, as the module does, over a page with
// no activity.
import {
  SETTLED_PAGE_DEADLINE_MS,
  SETTLED_PAGE_QUIET_MS,
  waitForSettled,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";

import { createRefWorld, type ElementInputs } from "../in-page";
import {
  browserMonotonicClock,
  type ActionOutcome,
  type Capture,
  type DocumentToken,
} from "../shared";

/** Playwright's dual capture of `root`, as a test gives it. */
export type DualCapture = (root: Element) => {
  distilledText: string;
  fullText: string;
  refsByElement: Map<Element, string>;
};

/**
 * The module `vi.mock` puts in place of browserInPage.ts: each document
 * gets a ref world of its own, and `snapshot`'s refs mark its elements.
 */
export function standInBrowserInPage(snapshot: DualCapture) {
  const worlds = new WeakMap<Document, ReturnType<typeof createRefWorld>>();
  let latest: ReturnType<typeof createRefWorld> | undefined;
  const worldOf = (currentDocument: Document) => {
    let world = worlds.get(currentDocument);
    if (!world) {
      world = createRefWorld((root, { aymeRefs }) => {
        const captured = snapshot(root);
        for (const [element, ref] of captured.refsByElement)
          aymeRefs.marks.set(element, { role: "", name: "", ref });
        return captured;
      });
      worlds.set(currentDocument, world);
    }
    return (latest = world);
  };
  const capture = (
    currentDocument: Document,
    inputs: ElementInputs
  ): Capture => ({
    document: "standIn" as DocumentToken,
    url: currentDocument.URL,
    ...worldOf(currentDocument).capture(currentDocument.body, inputs),
  });
  return {
    bindDocument: () => {},
    captureDocument: async (currentDocument: Document, inputs: ElementInputs) =>
      capture(currentDocument, inputs),
    beginDocumentAction: async (
      currentDocument: Document,
      inputs: () => Promise<ElementInputs>
    ) => ({
      before: capture(currentDocument, await inputs()),
      async perform<T>(
        perform: () => T | Promise<T>
      ): Promise<ActionOutcome<T>> {
        let done:
          { kind: "settled"; result: T } | { kind: "threw"; error: unknown };
        try {
          done = { kind: "settled", result: await perform() };
        } catch (error) {
          done = { kind: "threw", error };
        }
        const { stable } = await waitForSettled({
          activity: { subscribe: () => () => {} },
          clock: browserMonotonicClock,
          quietMs: SETTLED_PAGE_QUIET_MS,
          deadlineMs: SETTLED_PAGE_DEADLINE_MS,
        });
        return {
          ...done,
          stable,
          after: capture(currentDocument, await inputs()),
        };
      },
    }),
    elementsOf: (refs: readonly AriaRef[]) =>
      new Map(
        refs.flatMap((ref) => {
          const element = latest?.elementOf(ref);
          return element ? [[ref, element] as const] : [];
        })
      ),
  };
}
