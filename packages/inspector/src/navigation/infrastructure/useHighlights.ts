import { useCallback, useEffect, useRef } from "react";

import type { Look } from "../../shared";
import type { HighlightTarget } from "../domain/highlight";

/**
 * The page's two highlights: `hover` (dashed) for what the pointer is over
 * in the panel, `pin` (solid) for the selection. Each shows on its target's
 * elements in the latest look at the page, and follows every new look
 * handed to `onLook`. Unmounting removes them.
 */
export function useHighlights({
  targetsOf,
}: {
  /**
   * The registry target paths a highlight's path stands for, read as each
   * highlight shows, e.g. the roots of a collection's items.
   */
  targetsOf: (path: string) => ReadonlySet<string>;
}) {
  const latest = useRef<Look>(undefined);
  const layers = useRef<Record<HighlightLayer, LayerState>>({
    hover: { elements: [] },
    pinned: { elements: [] },
  });

  const resolve = useRef(targetsOf);
  useEffect(() => {
    resolve.current = targetsOf;
  }, [targetsOf]);

  /** Shows a layer's highlight on the target's elements in the latest look. */
  const showLayer = useCallback((layer: HighlightLayer) => {
    const state = layers.current[layer];
    const elements =
      state.target && latest.current
        ? targetElements(state.target, latest.current, resolve.current)
        : [];
    markElements(layer, state.elements, elements);
    state.elements = elements;
  }, []);

  const onLook = useCallback(
    (look: Look) => {
      latest.current = look;
      for (const layer of highlightLayers) showLayer(layer);
    },
    [showLayer]
  );

  /** The dashed highlight: what the pointer is over in the panel, if anything. */
  const hover = useCallback(
    (target: HighlightTarget | undefined) => {
      layers.current.hover.target = target;
      showLayer("hover");
    },
    [showLayer]
  );

  /** The solid highlight: the selection's element(s), if it has any. */
  const pin = useCallback(
    (target: HighlightTarget | undefined) => {
      layers.current.pinned.target = target;
      showLayer("pinned");
    },
    [showLayer]
  );

  useEffect(() => {
    const layerStates = layers.current;
    return () => {
      for (const layer of highlightLayers) {
        const state = layerStates[layer];
        markElements(layer, state.elements, []);
        state.elements = [];
      }
    };
  }, []);

  return { onLook, hover, pin };
}

/**
 * A target's elements in a look: a ref's element, or the elements of the
 * registry targets a path stands for, as far as the page state shows them.
 */
function targetElements(
  target: HighlightTarget,
  look: Look,
  targetsOf: (path: string) => ReadonlySet<string>
): Element[] {
  if ("ref" in target) {
    const element = [...look.state.elementsByRef].find(
      ([ref]) => ref === target.ref
    )?.[1];
    return element ? [element] : [];
  }
  const paths = targetsOf(target.path);
  return [
    ...new Set(
      look.targets
        .filter(({ path }) => paths.has(path))
        .map(({ element }) => element)
        .filter((element) => look.elementsInState.has(element))
    ),
  ];
}

type HighlightLayer = "hover" | "pinned";

const highlightLayers: readonly HighlightLayer[] = ["hover", "pinned"];

/** The host attribute of each layer; the host style draws them. */
const layerAttribute: Record<HighlightLayer, string> = {
  hover: "data-ayme-hover",
  pinned: "data-ayme-highlight",
};

type LayerState = {
  target?: HighlightTarget;
  elements: Element[];
};

function markElements(
  layer: HighlightLayer,
  previous: readonly Element[],
  next: readonly Element[]
) {
  const attribute = layerAttribute[layer];
  for (const element of previous)
    if (!next.includes(element)) element.removeAttribute(attribute);
  for (const element of next) element.setAttribute(attribute, "");
}
