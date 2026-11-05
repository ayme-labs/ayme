// Stands in the browser runtime's host of its in-page module
// (page-state/infrastructure/browserInPage.ts) where no browser lays the
// page out, as in jsdom: a capture runs the module's own ref world over the
// dual capture a test gives, in place of Playwright's.
import type { AriaRef } from "@ayme-dev/core/structural-observation";

import { createRefWorld, type ElementInputs } from "../in-page";
import type { Capture, DocumentToken } from "../shared";

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
  return {
    bindDocument: () => {},
    captureDocument: async (
      currentDocument: Document,
      inputs: ElementInputs
    ): Promise<Capture> => ({
      document: "standIn" as DocumentToken,
      url: currentDocument.URL,
      ...worldOf(currentDocument).capture(currentDocument.body, inputs),
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
