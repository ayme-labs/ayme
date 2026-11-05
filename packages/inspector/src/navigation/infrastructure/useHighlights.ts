import { useCallback, useEffect, useRef } from "react";

import { highlightStyles, pageOfDocument } from "@ayme-dev/ayme/internal";

import type { Look } from "../../shared";
import type { HighlightTarget } from "../domain/highlight";

/** What a highlight needs of a locator: Playwright's `highlight`, and what it hands back. */
export type HighlightLocator = {
  highlight(options: {
    style: Record<string, string | number>;
  }): Promise<{ dispose(): Promise<void> }>;
};

/** The `ayme-ref=` locator of a Structural Ref on the runtime's page. */
const onRuntimePage = (ref: string): HighlightLocator =>
  pageOfDocument(document).locator(`ayme-ref=${ref}`);

/**
 * The page's two highlights: `hover` (dashed) for what the pointer is over
 * in the panel, `pin` (solid) for the selection. Each shows on its target's
 * elements in the latest look at the page, through Playwright's
 * `locator.highlight` on each one's `ayme-ref=` locator: nothing is set on the
 * app's elements. They follow every new look handed to `onLook`. Unmounting
 * removes them.
 */
export function useHighlights({
  targetsOf,
  locate = onRuntimePage,
}: {
  /**
   * The registry target paths a highlight's path stands for, read as each
   * highlight shows, e.g. the roots of a collection's items.
   */
  targetsOf: (path: string) => ReadonlySet<string>;
  /** The locator of the element a Structural Ref names: on the runtime's page, unless given. */
  locate?: (ref: string) => HighlightLocator;
}) {
  const latest = useRef<Look>(undefined);
  const targets = useRef<Partial<Record<HighlightLayer, HighlightTarget>>>({});
  // What each layer shows now: its refs, each with the disposable of its highlight.
  const shown = useRef<Record<HighlightLayer, Map<string, Disposable>>>({
    hover: new Map(),
    pinned: new Map(),
  });
  const unmounted = useRef(false);
  // Changes go through one chain, so each reads the latest wish when it runs.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const resolve = useRef(targetsOf);
  const locator = useRef(locate);
  useEffect(() => {
    resolve.current = targetsOf;
    locator.current = locate;
  }, [targetsOf, locate]);

  /** Makes what the page shows what the layers' targets are now. */
  const apply = useCallback(async () => {
    const wanted = wantedRefs(
      unmounted.current ? {} : targets.current,
      latest.current,
      resolve.current
    );
    // An element both layers want shows the selection's.
    for (const ref of wanted.pinned) wanted.hover.delete(ref);
    // Highlights end before others start, so a ref moving from one layer to
    // the other is never ended after it started.
    for (const layer of highlightLayers)
      for (const [ref, disposable] of shown.current[layer])
        if (!wanted[layer].has(ref)) {
          shown.current[layer].delete(ref);
          await disposable.dispose().catch(() => {});
        }
    for (const layer of highlightLayers)
      for (const ref of wanted[layer])
        if (!shown.current[layer].has(ref))
          try {
            shown.current[layer].set(
              ref,
              await locator.current(ref).highlight({
                style: highlightStyles[layer],
              })
            );
          } catch {
            // The element went away: the next look shows what is there.
          }
  }, []);

  const show = useCallback(() => {
    queue.current = queue.current.then(apply, apply);
  }, [apply]);

  const onLook = useCallback(
    (look: Look) => {
      latest.current = look;
      show();
    },
    [show]
  );

  /** The dashed highlight: what the pointer is over in the panel, if anything. */
  const hover = useCallback(
    (target: HighlightTarget | undefined) => {
      targets.current.hover = target;
      show();
    },
    [show]
  );

  /** The solid highlight: the selection's element(s), if it has any. */
  const pin = useCallback(
    (target: HighlightTarget | undefined) => {
      targets.current.pinned = target;
      show();
    },
    [show]
  );

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      show();
    };
  }, [show]);

  /** Whether this target still has a connected element in the latest look. */
  const canHighlight = useCallback(
    (target: HighlightTarget) =>
      latest.current !== undefined &&
      targetElements(target, latest.current, resolve.current).some(
        ([element]) => element.isConnected
      ),
    []
  );

  return { onLook, hover, pin, canHighlight };
}

type Disposable = { dispose(): Promise<void> };

/** The refs each layer's target shows on in a look. */
function wantedRefs(
  targets: Partial<Record<HighlightLayer, HighlightTarget>>,
  look: Look | undefined,
  targetsOf: (path: string) => ReadonlySet<string>
): Record<HighlightLayer, Set<string>> {
  const refsOf = (target: HighlightTarget | undefined) =>
    new Set(
      target && look
        ? targetElements(target, look, targetsOf).map(([, ref]) => ref)
        : []
    );
  return { hover: refsOf(targets.hover), pinned: refsOf(targets.pinned) };
}

/**
 * A target's elements in a look, each with its ref: a ref's element, or the
 * elements of the registry targets a path stands for, as far as the page
 * state shows them.
 */
function targetElements(
  target: HighlightTarget,
  look: Look,
  targetsOf: (path: string) => ReadonlySet<string>
): [Element, string][] {
  const elements: ReadonlyMap<string, Element> = look.state.elementsByRef;
  if ("ref" in target) {
    const element = elements.get(target.ref);
    return element ? [[element, target.ref]] : [];
  }
  const refs = new Map<Element, string>();
  for (const [ref, element] of elements)
    if (!refs.has(element)) refs.set(element, ref);
  const paths = targetsOf(target.path);
  return [
    ...new Set(
      look.targets
        .filter(({ path }) => paths.has(path))
        .map(({ element }) => element)
        .filter((element) => look.elementsInState.has(element))
    ),
  ].flatMap((element) => {
    const ref = refs.get(element);
    return ref === undefined ? [] : [[element, ref] as [Element, string]];
  });
}

type HighlightLayer = "hover" | "pinned";

const highlightLayers: readonly HighlightLayer[] = ["hover", "pinned"];
