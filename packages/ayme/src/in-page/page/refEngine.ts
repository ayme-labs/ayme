// Stryker disable all
// The `ayme-ref` selector engine (ADR-0038): it resolves a Structural Ref
// through the document's slot, whichever host captured it. Built on its own
// into `aymeRefEngine` (build/inPageModule.ts), so it closes over nothing and
// registers on Playwright Lite's selectors and on Playwright's alike.
import type { Slot } from "./install";

export function engine() {
  const queryAll = (root: Node, ref: string): Element[] =>
    (globalThis as { [key: symbol]: Slot | undefined })[
      Symbol.for("ayme.inPage")
    ]?.queryRef(ref, root) ?? [];
  return {
    query: (root: Node, ref: string) => queryAll(root, ref)[0] ?? null,
    queryAll,
  };
}
