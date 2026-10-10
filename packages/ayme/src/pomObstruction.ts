/**
 * Package-internal: what a click on a Page Object Root the observation found
 * present but not available would reach instead (ADR-0035): the open native
 * modal the root is not in, the root's inert ancestor, or the element
 * hit-testing returns at the root's centre, as the root check measures them.
 * Undefined when hit-testing finds nothing in the way, such as a root the
 * viewport does not show. The runtime reports the measurement, never a kind
 * of widget.
 */
export function findObstruction(root: Element): Element | undefined {
  const document = root.ownerDocument;
  let modals: Element[];
  try {
    modals = [...document.querySelectorAll(":modal")];
  } catch {
    modals = [];
  }
  const outside = (modal: Element) =>
    !contains(modal, root) && !contains(root, modal);
  if (modals.length && modals.every(outside)) return modals.at(-1);
  for (let node: Element | null = root; node; node = parentElement(node)) {
    if (node.hasAttribute("inert")) return node;
    if (modals.includes(node)) break;
  }
  const rect = root.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  return hitElements(document, x, y).find((hit) => !contains(root, hit));
}

function parentElement(current: Element): Element | null {
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
  return contains(ancestor, candidate);
}

function contains(ancestor: Element, candidate: Element): boolean {
  for (let node: Element | null = candidate; node; node = parentElement(node))
    if (node === ancestor) return true;
  return false;
}

/** The elements at a point, topmost first, descending into open shadow roots. */
function hitElements(root: Document | ShadowRoot, x: number, y: number) {
  return root
    .elementsFromPoint(x, y)
    .flatMap((hit): Element[] =>
      hit.getRootNode() === root && hit.shadowRoot
        ? [...hitElements(hit.shadowRoot, x, y), hit]
        : [hit]
    );
}
