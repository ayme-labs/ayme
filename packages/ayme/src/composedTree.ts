/** Package-internal: the parent, through slots and shadow roots. */
export function parentElement(current: Element): Element | null {
  return (
    current.assignedSlot ??
    current.parentElement ??
    (current.getRootNode() as ShadowRoot).host ??
    null
  );
}

/** Package-internal: whether `ancestor` holds `candidate`, through slots and shadow roots. */
export function containsThroughShadow(
  ancestor: Element,
  candidate: Element
): boolean {
  for (let node: Element | null = candidate; node; node = parentElement(node))
    if (node === ancestor) return true;
  return false;
}

/**
 * Package-internal: the elements at a point, topmost first, descending into
 * open shadow roots.
 */
export function hitElements(
  root: Document | ShadowRoot,
  x: number,
  y: number
): Element[] {
  return root
    .elementsFromPoint(x, y)
    .flatMap((hit): Element[] =>
      hit.getRootNode() === root && hit.shadowRoot
        ? [...hitElements(hit.shadowRoot, x, y), hit]
        : [hit]
    );
}
