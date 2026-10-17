import type { Locator } from "@playwright/test";
import {
  containsThroughShadow as contains,
  hitElements,
  parentElement,
} from "./composedTree";
import { INSPECTOR_HOST_SELECTOR } from "./pageState";

/**
 * Package-internal: what the layout shows of one element (ADR-0035),
 * measured without scrolling or sending input: whether some part of it is
 * or would scroll into view, whether a click there would reach it, and, for
 * a shown element a click would not reach, what stopped it: `blocker`, the
 * open native modal the element is not in or the element's inert ancestor,
 * which blocks every click; else `hit`, the element hit-testing found over
 * the area the reachability check sampled, when it found one. Scroll
 * reachability describes the current layout, not content a scroll handler
 * might create. It names no kind of widget: a Page Object Root and an
 * element a Browser Tool addresses are measured alike.
 */
export type ReachMeasurement = {
  present: boolean;
  available: boolean;
  blocker?: Element;
  hit?: Element;
};

const absent: ReachMeasurement = { present: false, available: false };

type Rect = { left: number; right: number; top: number; bottom: number };
type Scroll = { element: Element; x: number; y: number };
type ScrollAlignment = "current" | "center" | "start" | "end";

function establishesContainingBlock(style: CSSStyleDeclaration): boolean {
  return (
    style.transform !== "none" ||
    style.perspective !== "none" ||
    style.filter !== "none" ||
    /layout|paint|strict|content/.test(style.contain) ||
    /transform|perspective|filter/.test(style.willChange)
  );
}

let batch: Map<unknown, WeakMap<Element, unknown>> | undefined;

/**
 * Package-internal: runs `measureAll`, a synchronous pass that measures a
 * batch of elements (every candidate of every tool) without changing the
 * page, sharing the work for their common ancestors and siblings. Each
 * element is measured at most once in the pass; outside one, every call
 * measures afresh, so a page change between calls is always seen.
 */
export function inReachBatch<T>(measureAll: () => T): T {
  if (batch) return measureAll();
  batch = new Map();
  try {
    return measureAll();
  } finally {
    batch = undefined;
  }
}

function memoizedInBatch<R>(measure: (element: Element) => R) {
  return (element: Element): R => {
    if (!batch) return measure(element);
    let memo = batch.get(measure) as WeakMap<Element, R> | undefined;
    if (!memo) batch.set(measure, (memo = new WeakMap()));
    if (memo.has(element)) return memo.get(element)!;
    const result = measure(element);
    memo.set(element, result);
    return result;
  };
}

const layoutAncestors = memoizedInBatch(measureLayoutAncestors);

const styleOf = memoizedInBatch((element) =>
  element.ownerDocument.defaultView!.getComputedStyle(element)
);

function measureLayoutAncestors(current: Element) {
  const ancestors: Element[] = [];
  let node = current;
  while (true) {
    const position = styleOf(node).position;
    let parent = parentElement(node);
    if (position === "fixed" || position === "absolute") {
      while (parent && parent !== current.ownerDocument.documentElement) {
        const style = styleOf(parent);
        if (
          establishesContainingBlock(style) ||
          (position === "absolute" && style.position !== "static")
        )
          break;
        parent = parentElement(parent);
      }
      if (
        position === "fixed" &&
        (!parent || !establishesContainingBlock(styleOf(parent)))
      )
        return { ancestors, fixedToViewport: true };
    }
    if (!parent) return { ancestors, fixedToViewport: false };
    ancestors.push(parent);
    node = parent;
  }
}

function scrollDelta(
  start: number,
  end: number,
  portStart: number,
  portEnd: number,
  current: number,
  maximum: number,
  scrollable: boolean,
  scale: number,
  reverse: boolean,
  alignment: ScrollAlignment
): number {
  if (!scrollable || maximum === 0 || scale <= 0 || alignment === "current")
    return 0;

  const offset =
    alignment === "start"
      ? start - portStart
      : alignment === "end"
        ? end - portEnd
        : (start + end) / 2 - (portStart + portEnd) / 2;
  const desired = current + offset / scale;
  const next = Math.max(
    reverse ? -maximum : 0,
    Math.min(reverse ? 0 : maximum, desired)
  );
  return (current - next) * scale;
}

function projectIntoPort(
  rect: Rect,
  port: Rect,
  scroller: Element,
  overflowX: string,
  overflowY: string,
  scaleX: number,
  scaleY: number,
  alignment: ScrollAlignment
): Scroll {
  const style = styleOf(scroller);
  const reverseX =
    style.direction === "rtl" || style.writingMode === "vertical-rl";
  const x = scrollDelta(
    rect.left,
    rect.right,
    port.left,
    port.right,
    scroller.scrollLeft,
    Math.max(0, scroller.scrollWidth - scroller.clientWidth),
    /^(auto|scroll|overlay)$/.test(overflowX),
    scaleX,
    reverseX,
    alignment
  );
  const y = scrollDelta(
    rect.top,
    rect.bottom,
    port.top,
    port.bottom,
    scroller.scrollTop,
    Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    /^(auto|scroll|overlay)$/.test(overflowY),
    scaleY,
    false,
    alignment
  );
  rect.left += x;
  rect.right += x;
  rect.top += y;
  rect.bottom += y;
  return { element: scroller, x, y };
}

function clip(
  rect: Rect,
  port: Rect,
  x: boolean,
  y: boolean
): Rect | undefined {
  const result = {
    left: x ? Math.max(rect.left, port.left) : rect.left,
    right: x ? Math.min(rect.right, port.right) : rect.right,
    top: y ? Math.max(rect.top, port.top) : rect.top,
    bottom: y ? Math.min(rect.bottom, port.bottom) : rect.bottom,
  };
  return result.right > result.left && result.bottom > result.top
    ? result
    : undefined;
}

// ponytail: rectangular px/% inset clips and collapsed basic shapes only;
// other clip geometry needs browser support rather than a CSS shape parser.
function clipBounds(current: Element): Rect | null | undefined {
  const style = styleOf(current);
  if (/^(?:circle|ellipse)\(0(?:px|%)?(?:\s|\))/.test(style.clipPath))
    return null;
  const inset = /^inset\(([^()]*)\)$/
    .exec(style.clipPath)?.[1]
    ?.split(" round ")[0];
  if (!inset) return;
  const values = inset.trim().split(/\s+/);
  if (!values.every((value) => /^-?[\d.]+(?:px|%)?$/.test(value))) return;
  const [top, right = top, bottom = top, left = right] = values;
  const box = current.getBoundingClientRect();
  const distance = (value: string, size: number, layoutSize: number) =>
    value.endsWith("%")
      ? (Number.parseFloat(value) * size) / 100
      : Number.parseFloat(value) * (layoutSize ? size / layoutSize : 1);
  const width = (current as HTMLElement).offsetWidth;
  const height = (current as HTMLElement).offsetHeight;
  return {
    left: box.left + distance(left!, box.width, width),
    right: box.right - distance(right!, box.width, width),
    top: box.top + distance(top!, box.height, height),
    bottom: box.bottom - distance(bottom!, box.height, height),
  };
}

function projectedOffset(current: Element, scrolls: readonly Scroll[]) {
  const { ancestors, fixedToViewport } = layoutAncestors(current);
  let left = 0;
  let top = 0;
  for (const scroll of scrolls) {
    if (scroll.element === current || !ancestors.includes(scroll.element))
      continue;
    if (
      fixedToViewport &&
      scroll.element === current.ownerDocument.scrollingElement
    )
      continue;
    left += scroll.x;
    top += scroll.y;
  }
  return { left, top };
}

function zIndex(style: CSSStyleDeclaration): number {
  if (style.zIndex === "auto") return 0;
  const value = Number(style.zIndex);
  return Number.isFinite(value) ? value : 0;
}

type Occluder = {
  element: Element;
  bounds: DOMRect;
  left: number;
  top: number;
};

function projectedSiblingOccluders(
  current: Element,
  scrolls: readonly Scroll[]
): Occluder[] {
  const view = current.ownerDocument.defaultView!;
  const NodeCtor = view.Node;
  const occluders: Occluder[] = [];

  // ponytail: sibling branch boxes cover the practical moving-overlay
  // case without reimplementing the browser's stacking algorithm.
  for (let branch = current; ;) {
    const parent = parentElement(branch);
    if (!parent) break;
    const branchStyle = styleOf(branch);
    const branchZ = zIndex(branchStyle);
    for (const sibling of parent.children) {
      if (sibling === branch) continue;
      const style = styleOf(sibling);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.pointerEvents === "none"
      )
        continue;
      const siblingZ = zIndex(style);
      const follows = Boolean(
        branch.compareDocumentPosition(sibling) &
        NodeCtor.DOCUMENT_POSITION_FOLLOWING
      );
      if (siblingZ < branchZ || (siblingZ === branchZ && !follows)) continue;
      const { left, top } = projectedOffset(sibling, scrolls);
      if (left === 0 && top === 0) continue;
      occluders.push({
        element: sibling,
        bounds: sibling.getBoundingClientRect(),
        left,
        top,
      });
    }
    branch = parent;
  }
  return occluders;
}

function containsPoint(
  bounds: { left: number; right: number; top: number; bottom: number },
  left: number,
  top: number,
  x: number,
  y: number
) {
  return (
    x >= bounds.left + left &&
    x < bounds.right + left &&
    y >= bounds.top + top &&
    y < bounds.bottom + top
  );
}

// The centre first, so the element named in the way is the one over it
// whenever that one is.
const samples = [
  [0.5, 0.5],
  ...[0.05, 0.5, 0.95].flatMap((horizontal) =>
    [0.05, 0.5, 0.95].map((vertical) => [horizontal, vertical] as const)
  ),
].filter(([h, v], index) => index === 0 || h !== 0.5 || v !== 0.5);

/**
 * Hit-tests `rect`, the area of `current` a scroll by `scrolls` would show:
 * true when a click on some sampled point would reach `current`, else the
 * first element found in the way, if any.
 */
function sampleReach(
  current: Element,
  rect: Rect,
  scrolls: readonly Scroll[]
): true | Element | undefined {
  const projectedOccluders = projectedSiblingOccluders(current, scrolls);
  let inTheWay: Element | undefined;
  // ponytail: bounded hit sampling, not pixel-perfect occlusion.
  for (const [horizontal, vertical] of samples) {
    const x = rect.left + (rect.right - rect.left) * horizontal!;
    const y = rect.top + (rect.bottom - rect.top) * vertical!;
    const occluder = projectedOccluders.find(({ bounds, left, top }) =>
      containsPoint(bounds, left, top, x, y)
    );
    if (occluder) {
      inTheWay ??= occluder.element;
      continue;
    }
    for (const hit of hitElements(current.ownerDocument, x, y)) {
      // Ayme's own Inspector lets the runtime's actions through to the page.
      if (inInspector(hit)) continue;
      if (contains(current, hit)) return true;
      // Ancestors are evidence only for a simulated scroll destination,
      // never proof that the current element itself is exposed. An element
      // nothing in which takes pointer events always leaves its ancestor as
      // the hit.
      if (
        scrolls.some(({ x, y }) => x !== 0 || y !== 0) &&
        contains(hit, current) &&
        takesPointerEvents(current)
      )
        return true;
      const { left, top } = projectedOffset(hit, scrolls);
      const bounds = hit.getBoundingClientRect();
      if (containsPoint(bounds, left, top, x, y)) {
        inTheWay ??= hit;
        break;
      }
    }
  }
  return inTheWay;
}

/**
 * Whether `element`, or a rendered element in it, open shadow roots
 * included, takes pointer events.
 */
const takesPointerEvents = memoizedInBatch((element: Element): boolean => {
  if (styleOf(element).pointerEvents !== "none") return true;
  const takes = (node: Element): boolean => {
    const style = styleOf(node);
    if (style.display === "none") return false;
    if (
      style.pointerEvents !== "none" &&
      style.visibility === "visible" &&
      node.getClientRects().length > 0
    )
      return true;
    return [...node.children, ...(node.shadowRoot?.children ?? [])].some(takes);
  };
  return [...element.children, ...(element.shadowRoot?.children ?? [])].some(
    takes
  );
});

function inInspector(element: Element): boolean {
  for (let node: Element | null = element; node; node = parentElement(node))
    if (node.matches(INSPECTOR_HOST_SELECTOR)) return true;
  return false;
}

/**
 * Package-internal: what blocks both every click on `element`, whatever
 * covers it, and its focus: the last opened native modal when the element is
 * not in one, else its inert ancestor.
 */
export function blockingAncestor(element: Element): Element | undefined {
  let modals: Element[];
  try {
    modals = [...element.ownerDocument.querySelectorAll(":modal")];
  } catch {
    modals = [];
  }
  if (
    modals.length &&
    !modals.some(
      (modal) => contains(modal, element) || contains(element, modal)
    )
  )
    return modals.at(-1);
  for (let node: Element | null = element; node; node = parentElement(node)) {
    if (node.hasAttribute("inert")) return node;
    // A modal escapes inherited inertness, but not its own inert attribute.
    if (modals.includes(node)) break;
  }
  return undefined;
}

/**
 * Package-internal: measures `element`, the one element `locator` resolves
 * to, as a Page Object Root: present only while the locator finds it
 * visible; see `ReachMeasurement`.
 */
export async function measurePomRoot(
  locator: Locator,
  element: Element
): Promise<ReachMeasurement> {
  try {
    if (!(await locator.isVisible())) return absent;
  } catch {
    return absent;
  }
  return measureReach(element);
}

/**
 * Package-internal: measures `element`; see `ReachMeasurement`. It takes
 * the element as shown: a caller that needs it visible checks that first.
 */
export const measureReach = memoizedInBatch(measureReachNow);

function measureReachNow(element: Element): ReachMeasurement {
  if (!element.isConnected || !element.ownerDocument.defaultView) return absent;
  const blocker = blockingAncestor(element);
  let present = false;
  let inTheWay: Element | undefined;
  for (const { source, bounds } of renderedBoxes(element)) {
    const layout = layoutAncestors(source);
    for (const alignment of alignments) {
      const shown = scrolledIntoView(source, bounds, layout, alignment);
      if (!shown) continue;
      if (blocker) return { present: true, available: false, blocker };
      present = true;
      const reach = sampleReach(element, shown.rect, shown.scrolls);
      if (reach === true) return { present: true, available: true };
      inTheWay ??= reach;
    }
  }
  if (!present) return absent;
  return inTheWay
    ? { present, available: false, hit: inTheWay }
    : { present, available: false };
}

const alignments = [
  "current",
  "center",
  "start",
  "end",
] as const satisfies readonly ScrollAlignment[];

/**
 * The boxes a click on `element` could land in: its own, or for one that
 * renders none (such as `display: contents`), its visible descendants'.
 */
function renderedBoxes(element: Element) {
  const ownRects = [...element.getClientRects()];
  return ownRects.length
    ? ownRects.map((bounds) => ({ source: element, bounds }))
    : [...element.querySelectorAll("*")].flatMap((source) => {
        const style = styleOf(source);
        if (style.visibility === "hidden" || style.visibility === "collapse")
          return [];
        return [...source.getClientRects()].map((bounds) => ({
          source,
          bounds,
        }));
      });
}

/**
 * The part of `bounds`, a box of `source`, the viewport would show once its
 * scroll containers scrolled it to `alignment`, and the scrolls that takes;
 * undefined when no part would show.
 */
function scrolledIntoView(
  source: Element,
  bounds: DOMRect,
  { ancestors, fixedToViewport }: ReturnType<typeof layoutAncestors>,
  alignment: ScrollAlignment
): { rect: Rect; scrolls: Scroll[] } | undefined {
  const document = source.ownerDocument;
  const htmlStyle = styleOf(document.documentElement);
  let rect = clippedBy(source, {
    left: bounds.left,
    right: bounds.right,
    top: bounds.top,
    bottom: bounds.bottom,
  });
  const scrolls: Scroll[] = [];
  for (const ancestor of ancestors) {
    if (!rect || ancestor === document.documentElement) break;
    // The body's overflow scrolls the viewport unless the root element's
    // own overflow takes that over.
    if (ancestor === document.body && overflowsVisibly(htmlStyle)) continue;
    const style = styleOf(ancestor);
    const { port, scaleX, scaleY } = scrollport(ancestor);
    scrolls.push(
      projectIntoPort(
        rect,
        port,
        ancestor,
        style.overflowX,
        style.overflowY,
        scaleX,
        scaleY,
        alignment
      )
    );
    rect = clip(
      rect,
      port,
      style.overflowX !== "visible",
      style.overflowY !== "visible"
    );
    rect = rect && clippedBy(ancestor, rect);
  }
  if (!rect) return undefined;
  const viewport: Rect = {
    left: 0,
    top: 0,
    right: document.documentElement.clientWidth,
    bottom: document.documentElement.clientHeight,
  };
  const scroller = document.scrollingElement;
  if (scroller && !fixedToViewport)
    scrolls.push(
      documentScroll(rect, viewport, scroller, htmlStyle, alignment)
    );
  const shown = clip(rect, viewport, true, true);
  return shown && { rect: shown, scrolls };
}

/**
 * `rect` cut to what `element`'s own clipping shows; undefined when it shows
 * none of it.
 */
function clippedBy(element: Element, rect: Rect): Rect | undefined {
  const bounds = clipBounds(element);
  if (bounds === null) return undefined;
  return bounds ? clip(rect, bounds, true, true) : rect;
}

function overflowsVisibly(style: CSSStyleDeclaration) {
  return style.overflowX === "visible" && style.overflowY === "visible";
}

/**
 * The box `ancestor` scrolls its content within, in the viewport's
 * coordinates, and how much a transform scales it.
 */
function scrollport(ancestor: Element) {
  const box = ancestor.getBoundingClientRect();
  const width = (ancestor as HTMLElement).offsetWidth || box.width;
  const height = (ancestor as HTMLElement).offsetHeight || box.height;
  const scaleX = width ? box.width / width : 1;
  const scaleY = height ? box.height / height : 1;
  const port: Rect = {
    left: box.left + ancestor.clientLeft * scaleX,
    top: box.top + ancestor.clientTop * scaleY,
    right: box.left + (ancestor.clientLeft + ancestor.clientWidth) * scaleX,
    bottom: box.top + (ancestor.clientTop + ancestor.clientHeight) * scaleY,
  };
  return { port, scaleX, scaleY };
}

/**
 * The document scroll that brings `rect` into `viewport`: the root
 * element's overflow, or the body's when the root's is visible, and a
 * visible one scrolls the viewport as auto does.
 */
function documentScroll(
  rect: Rect,
  viewport: Rect,
  scroller: Element,
  htmlStyle: CSSStyleDeclaration,
  alignment: ScrollAlignment
) {
  const document = scroller.ownerDocument;
  const bodyStyle = document.body && styleOf(document.body);
  const overflowX =
    htmlStyle.overflowX === "visible"
      ? (bodyStyle?.overflowX ?? "visible")
      : htmlStyle.overflowX;
  const overflowY =
    htmlStyle.overflowY === "visible"
      ? (bodyStyle?.overflowY ?? "visible")
      : htmlStyle.overflowY;
  return projectIntoPort(
    rect,
    viewport,
    scroller,
    overflowX === "visible" ? "auto" : overflowX,
    overflowY === "visible" ? "auto" : overflowY,
    1,
    1,
    alignment
  );
}
