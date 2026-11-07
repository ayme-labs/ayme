// Stryker disable all
// Reach (ADR-0041), measured in the document: whether a click on an element
// would land, what blocks it, what it would hit instead. The in-page module
// carries it, so Availability reads the same in the browser and in Node.
// Runs in the document, with nothing outside this file and what it imports.
import {
  containsThroughShadow as contains,
  EXCLUDED_SUBTREE_SELECTOR,
  HIT_TEST_THROUGH_ATTRIBUTE,
  parentElement,
  type ReachMeasurement,
} from "../../shared";
import { hitTargetOf, type HitTarget } from "./hitTarget";

/** `ReachMeasurement` before its elements are named. */
type Measured = {
  present: boolean;
  available: boolean;
  blocker?: Element;
  hit?: Element;
};

const absent: Measured = { present: false, available: false };
const reached: Measured = { present: true, available: true };

type Rect = { left: number; right: number; top: number; bottom: number };
/** Where the scroll containers stand: as now, or scrolled to centre the element. */
type ScrollAlignment = "current" | "center";

let batch: Map<unknown, WeakMap<object, unknown>> | undefined;

/**
 * Runs `measureAll`, a synchronous pass that measures a
 * batch of elements (every candidate of every tool) without changing the
 * page, sharing the work for their common ancestors. Each element is
 * measured at most once in the pass, and each document's open modals are
 * read once for all its elements; outside one, every call measures
 * afresh, so a page change between calls is always seen.
 */
function inReachBatch<T>(measureAll: () => T): T {
  if (batch) return measureAll();
  batch = new Map();
  try {
    return measureAll();
  } finally {
    batch = undefined;
  }
}

/** `compute()` for `node`, an element or its document, once per batch under `key`. */
function inBatch<R>(key: object, node: object, compute: () => R): R {
  if (!batch) return compute();
  let memo = batch.get(key) as WeakMap<object, R> | undefined;
  if (!memo) batch.set(key, (memo = new WeakMap()));
  if (memo.has(node)) return memo.get(node)!;
  const result = compute();
  memo.set(node, result);
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

/** Whether `style` lays out no box of its own, so positions and clips nothing. */
const isBoxless = (style: CSSStyleDeclaration) => style.display === "contents";

/** The ancestors whose scrolling moves `element`, nearest first. */
const layoutAncestors = (element: Element) =>
  inBatch(layoutAncestors, element, () => {
    const ancestors: Element[] = [];
    let node = element;
    while (true) {
      const style = styleOf(node);
      const position = isBoxless(style) ? "static" : style.position;
      let parent = parentElement(node);
      if (position === "fixed" || position === "absolute") {
        while (parent && parent !== element.ownerDocument.documentElement) {
          const style = styleOf(parent);
          if (
            !isBoxless(style) &&
            (establishesContainingBlock(style) ||
              (position === "absolute" && style.position !== "static"))
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
 * What blocks both every click on `element`, whatever covers it, and its
 * focus: the last opened native modal when the element is not in one, else
 * its inert ancestor.
 */
function blockingAncestor(element: Element): Element | undefined {
  const modals = openModals(element.ownerDocument);
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

/** The native modals open in `document`, in document order. */
const openModals = (document: Document) =>
  inBatch(openModals, document, () => {
    try {
      return [...document.querySelectorAll(":modal")];
    } catch {
      return [];
    }
  });

/**
 * The ancestor a modal layer opened over the rest of the page hid, when
 * `element` lies in it and takes no pointer events: what a modal library
 * (such as Radix) does instead of the native `:modal` or `inert`, hiding the
 * page's content from assistive technology and turning off its pointer
 * events. While nothing it renders turns them back on, it blocks every
 * click on `element` wherever `element` is scrolled, so an element out of
 * view is judged by it without the scroll a hit test would need.
 */
function hiddenBehindLayer(element: Element): Element | undefined {
  let hidden: Element | undefined;
  for (
    let node: Element | null = element;
    node && !hidden;
    node = parentElement(node)
  )
    if (node.getAttribute("aria-hidden") === "true") hidden = node;
  return hidden && !takesPointerEvents(element) ? hidden : undefined;
}

/**
 * Whether `element` or anything it renders takes pointer events: its
 * descendants, the content of its open shadow root and the elements assigned
 * to its slots.
 */
function takesPointerEvents(element: Element): boolean {
  if (styleOf(element).pointerEvents !== "none") return true;
  const rendered = [
    ...element.children,
    ...(element.shadowRoot?.children ?? []),
    ...(element instanceof HTMLSlotElement
      ? element.assignedElements({ flatten: true })
      : []),
  ];
  return rendered.some(takesPointerEvents);
}

/**
 * The reach of this document's elements, which `nameOf` names by Structural
 * Ref. Each measurement takes an element as shown: a caller that needs it
 * visible checks that first.
 */
export function createReach(nameOf: (element: Element) => string) {
  const named = (measured: Measured, element: Element): ReachMeasurement => {
    const { present, available, blocker, hit } = measured;
    return {
      present,
      available,
      ...(blocker ? { blocker: nameOf(blocker) } : {}),
      ...(hit ? { hit: walkedUp(hit, element).map(nameOf) } : {}),
    };
  };

  return {
    /**
     * Measures `element` for offering it, see `ReachMeasurement`: the hit
     * test is at the point a click on it would use.
     */
    measure(element: Element): ReachMeasurement {
      return named(measureCurrent(element), element);
    },
    /**
     * The first part of measuring `element` for a call that clicks it: what
     * can be told before the call's own scroll, or `"scroll"` when the
     * click scrolls first and `measureAfterScroll` is to follow. The scroll
     * moves an element only partly shown, too, until its nearest edge shows,
     * and the click's point moves with it.
     */
    measureBeforeScroll(element: Element): ReachMeasurement | "scroll" {
      const shown = shownParts(element, "current");
      if (!isPresent(element, shown)) return named(absent, element);
      const blocker =
        blockingAncestor(element) ??
        (clickTarget(element, shown) ? undefined : hiddenBehindLayer(element));
      if (blocker)
        return named({ present: true, available: false, blocker }, element);
      return "scroll";
    },
    /**
     * The measurement of `element` once the call's own scroll has run: the
     * point is final, so it is tested wherever it lies, in a part the
     * clipping takes out as well.
     */
    measureAfterScroll(element: Element): ReachMeasurement {
      return named(inTheWay(element, hitTargetOf(element)), element);
    },
    /** The ref of what blocks every click on `element` and its focus. */
    blockingAncestor(element: Element): string | undefined {
      const blocker = blockingAncestor(element);
      return blocker && nameOf(blocker);
    },
    inBatch: inReachBatch,
  };
}

function measureCurrent(element: Element): Measured {
  return inBatch(measureCurrent, element, () => {
    const shown = shownParts(element, "current");
    if (!isPresent(element, shown)) return absent;
    const blocker = blockingAncestor(element);
    if (blocker) return { present: true, available: false, blocker };
    const target = clickTarget(element, shown);
    const layer = target ? undefined : hiddenBehindLayer(element);
    if (layer) return { present: true, available: false, blocker: layer };
    return inTheWay(element, target);
  });
}

/**
 * Where a click on `element` would land and what it would hit, when that
 * point is in a part of the element `shown` now; undefined when it is not,
 * so there is nothing to test yet: the click scrolls there first.
 */
function clickTarget(
  element: Element,
  shown: readonly Rect[]
): HitTarget | undefined {
  const target = hitTargetOf(element);
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
 * The measurement `target`, the hit test on `element`, makes of a present
 * element: in the way is what the click would hit instead. A runtime action
 * goes through an excluded subtree, so a hit on one is what the same test
 * finds with that subtree out of hit testing.
 */
function inTheWay(element: Element, target: HitTarget | undefined): Measured {
  let hit = target?.hit;
  const host = hit && excludedSubtreeOf(hit);
  if (host) hit = withoutHitTesting(host, () => hitTargetOf(element))?.hit;
  return hit ? { present: true, available: false, hit } : reached;
}

/**
 * `hit` and its ancestors up to the first that holds `element`, or `hit`
 * alone when it holds `element` itself, as `element`'s own ancestor does when
 * nothing else takes the click, or is an open native modal.
 */
function walkedUp(hit: Element, element: Element): Element[] {
  if (contains(hit, element) || isModal(hit)) return [hit];
  const elements: Element[] = [];
  for (
    let node: Element | null = hit;
    node && !contains(node, element);
    node = parentElement(node)
  )
    elements.push(node);
  return elements;
}

function isModal(element: Element): boolean {
  try {
    return element.matches(":modal");
  } catch {
    return false;
  }
}

function excludedSubtreeOf(element: Element): Element | undefined {
  for (let node: Element | null = element; node; node = parentElement(node))
    if (node.matches(EXCLUDED_SUBTREE_SELECTOR)) return node;
  return undefined;
}

/**
 * `measure()` while `host`, the root of an excluded subtree, carries the mark
 * on which its client's own stylesheet takes everything in it out of hit
 * testing, then as it was. The mark is an attribute because the host's styles
 * outrank the page's.
 */
function withoutHitTesting<R>(host: Element, measure: () => R): R {
  const marked = host.hasAttribute(HIT_TEST_THROUGH_ATTRIBUTE);
  host.setAttribute(HIT_TEST_THROUGH_ATTRIBUTE, "");
  try {
    return measure();
  } finally {
    if (!marked) host.removeAttribute(HIT_TEST_THROUGH_ATTRIBUTE);
  }
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
 * rendered descendants', each clipped and scrolled by that descendant's own
 * ancestors, which a positioned one escapes.
 */
function shownParts(element: Element, alignment: ScrollAlignment): Rect[] {
  if (!element.isConnected || !element.ownerDocument.defaultView) return [];
  return renderedBoxes(element).flatMap(({ source, box }) => {
    const rect = scrolledIntoView(
      source,
      box,
      layoutAncestors(source),
      alignment
    );
    return rect ? [rect] : [];
  });
}

/**
 * The boxes a click on `element` could land in, each with the element whose
 * layout places it: its own, or for one that renders none (such as
 * `display: contents`) its visible descendants' and the text of those that
 * render none either, placed by the text's parent.
 */
function renderedBoxes(element: Element) {
  const own = [...element.getClientRects()];
  if (own.length) return own.map((box) => ({ source: element, box }));
  if (!isBoxless(styleOf(element))) return [];
  const boxes: { source: Element; box: DOMRect }[] = [];
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const source =
      node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    if (!source) continue;
    const { visibility } = styleOf(source);
    if (visibility === "hidden" || visibility === "collapse") continue;
    if (node === source) {
      for (const box of source.getClientRects()) boxes.push({ source, box });
    } else if (!source.getClientRects().length) {
      // Text in an element that renders no box lies in no descendant's box.
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) boxes.push({ source, box });
    }
  }
  return boxes;
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
    const { port, scaleX, scaleY } = scrollport(ancestor);
    if (alignment === "center")
      scrollToCentre(
        rect,
        port,
        ancestor,
        style.overflowX,
        style.overflowY,
        scaleX,
        scaleY
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
 * within the scroll range on each axis the overflow lets scroll. The scroll
 * offsets are in the scroller's own units, which a transform scales by
 * `scaleX` and `scaleY` into the viewport's.
 */
function scrollToCentre(
  rect: Rect,
  port: Rect,
  scroller: Element,
  overflowX: string,
  overflowY: string,
  scaleX = 1,
  scaleY = 1
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
    scale: number,
    reverse: boolean
  ) => {
    if (maximum <= 0 || scale <= 0) return 0;
    const desired =
      current + ((start + end) / 2 - (portStart + portEnd) / 2) / scale;
    const next = Math.max(
      reverse ? -maximum : 0,
      Math.min(reverse ? 0 : maximum, desired)
    );
    return (current - next) * scale;
  };
  const x = scrollable(overflowX)
    ? shift(
        rect.left,
        rect.right,
        port.left,
        port.right,
        scroller.scrollLeft,
        scroller.scrollWidth - scroller.clientWidth,
        scaleX,
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
        scaleY,
        false
      )
    : 0;
  rect.left += x;
  rect.right += x;
  rect.top += y;
  rect.bottom += y;
}

/**
 * The box `ancestor` scrolls its content within, in the viewport's
 * coordinates, and how much a transform scales it: the bounding box is
 * transformed, the client sizes and scroll offsets are not.
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
  if (isBoxless(styleOf(element))) return rect;
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
