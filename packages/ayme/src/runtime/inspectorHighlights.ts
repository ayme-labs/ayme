import { highlightStyles } from "../in-page";
import type { InspectorHighlightLayer } from "../shared";
import type { InspectorContractPorts } from "./inspectorContract";

/** What a highlight needs of a locator: Playwright's `highlight`. */
export type Highlightable = {
  highlight(options: {
    style: Record<string, string | number>;
  }): Promise<{ dispose(): Promise<void> }>;
};

type Disposable = { dispose(): Promise<void> };
const layers: readonly InspectorHighlightLayer[] = ["hover", "pinned"];

/**
 * The page's two highlights, each shown on its refs' elements through
 * Playwright's `locator.highlight` on `locate(ref)`, their `ayme-ref=` locators: nothing is
 * set on the app's elements. A change goes through one chain, so each reads
 * the latest wish when it runs.
 */
export function createHighlights(
  locate: (ref: string) => Highlightable
): InspectorContractPorts["highlights"] {
  const wanted: Record<InspectorHighlightLayer, Set<string>> = {
    hover: new Set(),
    pinned: new Set(),
  };
  const shown: Record<InspectorHighlightLayer, Map<string, Disposable>> = {
    hover: new Map(),
    pinned: new Map(),
  };
  let queue: Promise<void> = Promise.resolve();

  const apply = async () => {
    const want = {
      hover: new Set(
        [...wanted.hover].filter((ref) => !wanted.pinned.has(ref))
      ),
      pinned: wanted.pinned,
    };
    // Highlights end before others start, so a ref moving from one layer to
    // the other is never ended after it started.
    for (const layer of layers)
      for (const [ref, disposable] of shown[layer])
        if (!want[layer].has(ref)) {
          shown[layer].delete(ref);
          await disposable.dispose().catch(() => {});
        }
    for (const layer of layers)
      for (const ref of want[layer])
        if (!shown[layer].has(ref))
          try {
            shown[layer].set(
              ref,
              await locate(ref).highlight({ style: highlightStyles[layer] })
            );
          } catch {
            // The element went away: the next look shows what is there.
          }
  };

  return {
    set(layer, refs) {
      wanted[layer] = new Set(refs);
      queue = queue.then(apply, apply);
      return queue;
    },
  };
}
