// Stryker disable all
// The element a click on `element` would hit, as the pinned Playwright's
// `expectHitTarget(hitPoint, targetElement)` computes it before it decides
// whether the hit reaches the target. The pinned InjectedScript only returns
// a description of that element, so this carries its computation step by
// step, as Playwright Lite's own hit test does: the enclosing shadow roots of
// the target out to the document, then, from the document inwards,
// `elementsFromPoint` on each root while the hit stays the next root's host.
// Runs in the document, with nothing outside this file.

type Point = { x: number; y: number };

/** Where a click on `element` would land, and what it would hit there instead of it. */
export type HitTarget = { point: Point; hit?: Element };

/**
 * The point a click on `element` would use and what it would hit there right
 * now, without scrolling or waiting; undefined where Playwright's click
 * would throw before testing (not connected, not rendered, outside the
 * viewport).
 */
export function hitTargetOf(element: Element): HitTarget | undefined {
  const point = clickPoint(element);
  if (!point) return undefined;
  const target = retarget(element);
  const hit = hitElementAt(point, target);
  if (hit && hitReaches(hit, target)) return { point };
  return {
    point,
    hit: deepestHitAt(hit ?? element.ownerDocument.documentElement, point),
  };
}

/** Pinned `InjectedScript.retarget(node, "button-link")`. */
function retarget(element: Element): Element {
  if (
    element.matches("input, textarea, select") ||
    (element as HTMLElement).isContentEditable
  )
    return element;
  return element.closest("button, [role=button], a, [role=link]") || element;
}

/** Pinned `pointerPoint`: the centre of the first box of `element` the viewport shows. */
function clickPoint(element: Element): Point | undefined {
  if (!element.isConnected) return undefined;
  const document = element.ownerDocument;
  const window = document.defaultView;
  if (!window) return undefined;
  let rects = Array.from(element.getClientRects());
  if (
    !rects.length &&
    window.getComputedStyle(element).display === "contents"
  ) {
    const range = document.createRange();
    range.selectNodeContents(element);
    rects = Array.from(range.getClientRects());
  }
  if (!rects.length) return undefined;
  const viewport =
    document.compatMode === "BackCompat"
      ? document.body
      : document.documentElement;
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  for (const rect of rects) {
    const left = Math.max(0, rect.left);
    const right = Math.min(width, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(height, rect.bottom);
    if (right > left && bottom > top && (right - left) * (bottom - top) > 0.99)
      return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }
  return undefined;
}

function hitElementAt(point: Point, target: Element): Element | undefined {
  const roots: (Document | ShadowRoot)[] = [];
  for (let parent: Element | undefined = target; parent;) {
    const root = enclosingRoot(parent);
    if (!root) break;
    roots.push(root);
    if (root.nodeType === Node.DOCUMENT_NODE) break;
    parent = (root as ShadowRoot).host;
  }
  let hit: Element | undefined;
  for (let index = roots.length - 1; index >= 0; index--) {
    const inner = innermostElementAt(roots[index]!, point);
    if (!inner) break;
    hit = inner;
    if (index && inner !== (roots[index - 1] as ShadowRoot).host) break;
  }
  return hit;
}

/**
 * The first of `root.elementsFromPoint`, with a `display: contents` element
 * the single-element query reports put in front and a shadow host Chromium
 * lists in front of its own tree taken out.
 */
function innermostElementAt(
  root: Document | ShadowRoot,
  point: Point
): Element | undefined {
  const elements = root.elementsFromPoint(point.x, point.y);
  const single = root.elementFromPoint(point.x, point.y);
  if (single && elements[0] && parentOrHost(single) === elements[0]) {
    const view = single.ownerDocument.defaultView;
    if (view?.getComputedStyle(single).display === "contents")
      elements.unshift(single);
  }
  if (elements[0] && elements[0].shadowRoot === root && elements[1] === single)
    elements.shift();
  return elements[0];
}

/** The hit reaches `target` when walking up from it through slots and hosts arrives there. */
function hitReaches(hit: Element, target: Element): boolean {
  let element: Element | undefined = hit;
  while (element && element !== target)
    element = element.assignedSlot ?? parentOrHost(element);
  return element === target;
}

/**
 * The deepest element under `hit` at `point`: the hit test stops at a shadow
 * host whose tree does not enclose the target, which is what the browser
 * reports to the document. This descends into that host's open root so the
 * element in the way is named, not its host. It never changes the reach
 * decision, which is made before it runs.
 */
function deepestHitAt(hit: Element, point: Point): Element {
  for (;;) {
    const root = hit.shadowRoot;
    if (!root) return hit;
    const inner = innermostElementAt(root, point);
    if (!inner || inner === hit || inner.getRootNode() !== root) return hit;
    hit = inner;
  }
}

function parentOrHost(element: Element): Element | undefined {
  if (element.parentElement) return element.parentElement;
  const parent = element.parentNode;
  if (parent && parent.nodeType === Node.DOCUMENT_FRAGMENT_NODE)
    return (parent as ShadowRoot).host;
  return undefined;
}

function enclosingRoot(element: Element): Document | ShadowRoot | undefined {
  let node: Node = element;
  while (node.parentNode) node = node.parentNode;
  return node.nodeType === Node.DOCUMENT_FRAGMENT_NODE ||
    node.nodeType === Node.DOCUMENT_NODE
    ? (node as Document | ShadowRoot)
    : undefined;
}
