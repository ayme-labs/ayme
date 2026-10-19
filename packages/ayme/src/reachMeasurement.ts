import type { Locator, Page } from "@playwright/test";
import {
  pointerHitTarget,
  type PointerHitTarget,
} from "@ayme-dev/playwright-lite/internal";
import {
  containsThroughShadow as contains,
  parentElement,
} from "./composedTree";
import { INSPECTOR_HOST_SELECTOR } from "./pageState";

/**
 * Package-internal: what the layout shows of one element (ADR-0035,
 * ADR-0041), measured without scrolling or sending input: `present` while
 * some part of it shows, or would once its scroll containers and the
 * viewport scrolled to it; `available` while a click would reach it; and,
 * for a present element a click would not reach, what stopped it:
 * `blocker`, the open native modal the element is not in or the element's
 * inert ancestor, which blocks every click; else `hit`, the element
 * playwright-lite's own hit test found at the point it would click, when
 * that point is in a part of the element shown now. Otherwise the element is
 * not hit-tested: the call scrolls it into view first and tests it there,
 * as it does every element, since that scroll also moves one partly shown.
 * Presence
 * describes the current layout, not content a scroll handler might create.
 * It names no kind of widget: a Page Object Root and an element a Browser
 * Tool addresses are measured alike.
 */
export type ReachMeasurement = {
  present: boolean;
  available: boolean;
  blocker?: Element;
  hit?: Element;
};

const absent: ReachMeasurement = { present: false, available: false };
const reached: ReachMeasurement = { present: true, available: true };

type Rect = { left: number; right: number; top: number; bottom: number };
/** Where the scroll containers stand: as now, or scrolled to centre the element. */
type ScrollAlignment = "current" | "center";

let batch: Map<unknown, WeakMap<Element, unknown>> | undefined;

/**
 * Package-internal: runs `measureAll`, a synchronous pass that measures a
 * batch of elements (every candidate of every tool) without changing the
 * page, sharing the work for their common ancestors. Each element is
 * measured at most once in the pass; outside one, every call measures
 * afresh, so a page change between calls is always seen.
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

/** `compute()` for `element`, once per batch under `key`. */
function inBatch<R>(key: object, element: Element, compute: () => R): R {
  if (!batch) return compute();
  let memo = batch.get(key) as WeakMap<Element, R> | undefined;
  if (!memo) batch.set(key, (memo = new WeakMap()));
  if (memo.has(element)) return memo.get(element)!;
  const result = compute();
  memo.set(element, result);
  return result;
}

const styleOf = (element: Element) =>
  inBatch(styleOf, element, () =>
    element.ownerDocument.defaultView!.getComputedStyle(element)
  );

function establishesContainingBlock(style: CSSStyleDeclaration): boolean {
  return (
    style.transform !== "none" ||
    style.perspective !== "none" ||
    style.filter !== "none" ||
    /layout|paint|strict|content/.test(style.contain) ||
    /transform|perspective|filter/.test(style.willChange)
  );
}

/** The ancestors whose scrolling moves `element`, nearest first. */
const layoutAncestors = (element: Element) =>
  inBatch(layoutAncestors, element, () => {
    const ancestors: Element[] = [];
    let node = element;
    while (true) {
      const position = styleOf(node).position;
      let parent = parentElement(node);
      if (position === "fixed" || position === "absolute") {
        while (parent && parent !== element.ownerDocument.documentElement) {
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
  });

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
  return measureReach(locator.page(), element);
}

/**
 * Package-internal: measures `element` for offering it, see
 * `ReachMeasurement`: the hit test is `page`'s own, at the point a click of
 * `page` would use. It takes the element as shown: a caller that needs it
 * visible checks that first.
 */
export function measureReach(page: Page, element: Element): ReachMeasurement {
  return inBatch(measureReach, element, () => {
    const shown = shownParts(element, "current");
    if (!isPresent(element, shown)) return absent;
    const blocker = blockingAncestor(element);
    if (blocker) return { present: true, available: false, blocker };
    return inTheWay(clickTarget(page, element, shown));
  });
}

/**
 * Package-internal: measures `element`, the one element `locator` resolves
 * to, for a call that clicks it, see `ReachMeasurement`: the call's own
 * scroll, `locator.scrollIntoViewIfNeeded()`, is run first, so the hit test
 * is where the click will land. The scroll moves an element only partly
 * shown, too, until its nearest edge shows, and the click's point moves with
 * it. A scroll that fails leaves the measurement to the action, whose own
 * error says why.
 */
export async function measureReachAtCall(
  locator: Locator,
  element: Element
): Promise<ReachMeasurement> {
  if (!isPresent(element, shownParts(element, "current"))) return absent;
  const blocker = blockingAncestor(element);
  if (blocker) return { present: true, available: false, blocker };
  try {
    await locator.scrollIntoViewIfNeeded();
  } catch {
    return reached;
  }
  return inTheWay(
    clickTarget(locator.page(), element, shownParts(element, "current"))
  );
}

/**
 * Where a click of `page` on `element` would land and what it would hit, when
 * that point is in a part of the element `shown` now; undefined when it is
 * not, so there is nothing to test yet: the click scrolls there first.
 */
function clickTarget(
  page: Page,
  element: Element,
  shown: readonly Rect[]
): PointerHitTarget | undefined {
  const target = pointerHitTarget(page, element);
  return target &&
    shown.some(
      ({ left, right, top, bottom }) =>
        target.point.x >= left &&
        target.point.x < right &&
        target.point.y >= top &&
        target.point.y < bottom
    )
    ? target
    : undefined;
}

/**
 * The measurement `target` makes of a present element: in the way is what
 * the click would hit instead, unless that is Ayme's own Inspector, which
 * lets a runtime action through.
 */
function inTheWay(target: PointerHitTarget | undefined): ReachMeasurement {
  const hit = target?.hit;
  return hit && !inInspector(hit)
    ? { present: true, available: false, hit }
    : reached;
}

function inInspector(element: Element): boolean {
  for (let node: Element | null = element; node; node = parentElement(node))
    if (node.matches(INSPECTOR_HOST_SELECTOR)) return true;
  return false;
}

/**
 * Whether some part of `element` shows now (`shown`, its parts that do), or
 * would once its scroll containers and the viewport scrolled it to their
 * centre.
 */
function isPresent(element: Element, shown: readonly Rect[]): boolean {
  return shown.length > 0 || shownParts(element, "center").length > 0;
}

/**
 * The parts of `element`'s boxes the viewport shows with its scroll
 * containers at `alignment`, through their clipping. The boxes are its own,
 * or for an element that renders none (such as `display: contents`) its
 * contents', as playwright-lite picks its point.
 */
function shownParts(element: Element, alignment: ScrollAlignment): Rect[] {
  if (!element.isConnected || !element.ownerDocument.defaultView) return [];
  let boxes: DOMRect[] = [...element.getClientRects()];
  if (!boxes.length && styleOf(element).display === "contents") {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    boxes = [...range.getClientRects()];
  }
  const layout = layoutAncestors(element);
  return boxes.flatMap((box) => {
    const rect = scrolledIntoView(element, box, layout, alignment);
    return rect ? [rect] : [];
  });
}

/**
 * The part of `box`, a box of `element`, the viewport shows with its scroll
 * containers at `alignment`; undefined when it shows none of it.
 */
function scrolledIntoView(
  element: Element,
  box: DOMRect,
  { ancestors, fixedToViewport }: ReturnType<typeof layoutAncestors>,
  alignment: ScrollAlignment
): Rect | undefined {
  const document = element.ownerDocument;
  const html = styleOf(document.documentElement);
  let rect = clippedBy(element, {
    left: box.left,
    right: box.right,
    top: box.top,
    bottom: box.bottom,
  });
  for (const ancestor of ancestors) {
    if (!rect || ancestor === document.documentElement) break;
    // The body's overflow scrolls the viewport unless the root element's
    // own overflow takes that over.
    if (ancestor === document.body && overflowsVisibly(html)) continue;
    const style = styleOf(ancestor);
    const port = scrollport(ancestor);
    if (alignment === "center")
      scrollToCentre(rect, port, ancestor, style.overflowX, style.overflowY);
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
  if (scroller && !fixedToViewport && alignment === "center") {
    // The root element's overflow scrolls the viewport, or the body's when
    // the root's is visible, and a visible one scrolls as auto does.
    const body = document.body && styleOf(document.body);
    const overflow = (axis: "overflowX" | "overflowY") => {
      const value = html[axis] === "visible" ? body?.[axis] : html[axis];
      return value && value !== "visible" ? value : "auto";
    };
    scrollToCentre(
      rect,
      viewport,
      scroller,
      overflow("overflowX"),
      overflow("overflowY")
    );
  }
  return clip(rect, viewport, true, true);
}

/**
 * Moves `rect` as the scroll of `scroller` that centres it in `port` would,
 * within the scroll range on each axis the overflow lets scroll.
 */
function scrollToCentre(
  rect: Rect,
  port: Rect,
  scroller: Element,
  overflowX: string,
  overflowY: string
) {
  const scrollable = (overflow: string) =>
    /^(auto|scroll|overlay)$/.test(overflow);
  const style = styleOf(scroller);
  const reversed =
    style.direction === "rtl" || style.writingMode === "vertical-rl";
  const shift = (
    start: number,
    end: number,
    portStart: number,
    portEnd: number,
    current: number,
    maximum: number,
    reverse: boolean
  ) => {
    if (maximum <= 0) return 0;
    const desired = current + (start + end) / 2 - (portStart + portEnd) / 2;
    const next = Math.max(
      reverse ? -maximum : 0,
      Math.min(reverse ? 0 : maximum, desired)
    );
    return current - next;
  };
  const x = scrollable(overflowX)
    ? shift(
        rect.left,
        rect.right,
        port.left,
        port.right,
        scroller.scrollLeft,
        scroller.scrollWidth - scroller.clientWidth,
        reversed
      )
    : 0;
  const y = scrollable(overflowY)
    ? shift(
        rect.top,
        rect.bottom,
        port.top,
        port.bottom,
        scroller.scrollTop,
        scroller.scrollHeight - scroller.clientHeight,
        false
      )
    : 0;
  rect.left += x;
  rect.right += x;
  rect.top += y;
  rect.bottom += y;
}

/** The box `ancestor` scrolls its content within, in the viewport's coordinates. */
function scrollport(ancestor: Element): Rect {
  const box = ancestor.getBoundingClientRect();
  return {
    left: box.left + ancestor.clientLeft,
    top: box.top + ancestor.clientTop,
    right: box.left + ancestor.clientLeft + ancestor.clientWidth,
    bottom: box.top + ancestor.clientTop + ancestor.clientHeight,
  };
}

function overflowsVisibly(style: CSSStyleDeclaration) {
  return style.overflowX === "visible" && style.overflowY === "visible";
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

/**
 * `rect` cut to what `element`'s own clipping shows; undefined when it shows
 * none of it.
 */
function clippedBy(element: Element, rect: Rect): Rect | undefined {
  const bounds = clipBounds(element);
  if (bounds === null) return undefined;
  return bounds ? clip(rect, bounds, true, true) : rect;
}

// ponytail: rectangular px/% inset clips and collapsed basic shapes only;
// other clip geometry needs browser support rather than a CSS shape parser.
function clipBounds(element: Element): Rect | null | undefined {
  const style = styleOf(element);
  if (/^(?:circle|ellipse)\(0(?:px|%)?(?:\s|\))/.test(style.clipPath))
    return null;
  const inset = /^inset\(([^()]*)\)$/
    .exec(style.clipPath)?.[1]
    ?.split(" round ")[0];
  if (!inset) return;
  const values = inset.trim().split(/\s+/);
  if (!values.every((value) => /^-?[\d.]+(?:px|%)?$/.test(value))) return;
  const [top, right = top, bottom = top, left = right] = values;
  const box = element.getBoundingClientRect();
  const distance = (value: string, size: number, layoutSize: number) =>
    value.endsWith("%")
      ? (Number.parseFloat(value) * size) / 100
      : Number.parseFloat(value) * (layoutSize ? size / layoutSize : 1);
  const width = (element as HTMLElement).offsetWidth;
  const height = (element as HTMLElement).offsetHeight;
  return {
    left: box.left + distance(left!, box.width, width),
    right: box.right - distance(right!, box.width, width),
    top: box.top + distance(top!, box.height, height),
    bottom: box.bottom - distance(bottom!, box.height, height),
  };
}
