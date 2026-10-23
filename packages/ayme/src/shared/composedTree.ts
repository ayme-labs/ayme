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
