import { useCallback, useEffect, useRef } from "react";

import type { InspectorHighlightLayer } from "@ayme-dev/ayme/inspector";

import { inspectorClient, type InspectorClient, type Look } from "../../shared";
import type { HighlightTarget } from "../domain/highlight";

/**
 * The page's two highlights: `hover` (dashed) for what the pointer is over
 * in the panel, `pin` (solid) for the selection. Each shows on its target's
 * elements in the latest look at the page, through the Inspector contract, which
 * has the runtime draw Playwright's highlight on each one's `ayme-ref=`
 * locator: nothing is set on the app's elements. They follow every new look handed to `onLook`. Unmounting
 * removes them.
 */
export function useHighlights({
  targetsOf,
  client = inspectorClient(),
}: {
  /**
   * The registry target paths a highlight's path stands for, read as each
   * highlight shows, e.g. the roots of a collection's items.
   */
  targetsOf: (path: string) => ReadonlySet<string>;
  /** The Inspector's client of the contract; the document's own unless given. */
  client?: InspectorClient;
}) {
  const latest = useRef<Look>(undefined);
  const targets = useRef<Partial<Record<HighlightLayer, HighlightTarget>>>({});
  const unmounted = useRef(false);
  const resolve = useRef(targetsOf);
  const sendTo = useRef(client);
  useEffect(() => {
    resolve.current = targetsOf;
    sendTo.current = client;
  }, [targetsOf, client]);

  /**
   * Tells the runtime what each layer's target shows on now. The runtime
   * takes the commands in order, an element both layers want showing the
   * selection's, and ends highlights before it starts others.
   */
  const apply = useCallback(() => {
    const wanted = wantedRefs(
      unmounted.current ? {} : targets.current,
      latest.current,
      resolve.current
    );
    for (const layer of highlightLayers)
      void sendTo.current.highlight(layer, [...wanted[layer]]).catch(() => {
        // The element went away: the next look shows what is there.
      });
  }, []);

  const show = apply;

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

type HighlightLayer = InspectorHighlightLayer;

const highlightLayers: readonly HighlightLayer[] = ["hover", "pinned"];
