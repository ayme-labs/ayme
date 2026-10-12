import type { Locator } from "@playwright/test";
import { resolveLocatorElements } from "@ayme-dev/playwright-lite/internal";
import {
  containsThroughShadow as contains,
  hitElements,
  parentElement,
} from "./composedTree";

/**
 * Package-internal: what one observation of a Page Object Root found
 * (ADR-0035): whether it is on the page, whether a click would reach it, and,
 * for a present root a click would not reach, what is in the way when the
 * measurement can name it: the open native modal the root is not in, the
 * root's inert ancestor, or the element hit-testing found over the area the
 * reachability check sampled. The runtime reports the measurement, never a
 * kind of widget.
 */
export type PomRootState = {
  present: boolean;
  available: boolean;
  obstruction?: Element;
};

const absent: PomRootState = { present: false, available: false };

/**
 * Package-internal: observes one Page Object Root without scrolling or
 * sending input. Scroll reachability describes the current layout, not
 * content a scroll handler might create.
 */
export async function observePomRoot(locator: Locator): Promise<PomRootState> {
  try {
    if ((await locator.count()) !== 1 || !(await locator.isVisible()))
      return absent;
  } catch {
    return absent;
  }
  const elements = resolveLocatorElements(locator);
  return elements.length === 1 ? measurePomRoot(elements[0]!) : absent;
}

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

function layoutAncestors(current: Element) {
  const view = current.ownerDocument.defaultView!;
  const ancestors: Element[] = [];
  let node = current;
  while (true) {
    const position = view.getComputedStyle(node).position;
    let parent = parentElement(node);
    if (position === "fixed" || position === "absolute") {
      while (parent && parent !== current.ownerDocument.documentElement) {
        const style = view.getComputedStyle(parent);
        if (
          establishesContainingBlock(style) ||
          (position === "absolute" && style.position !== "static")
        )
          break;
        parent = parentElement(parent);
      }
      if (
        position === "fixed" &&
        (!parent || !establishesContainingBlock(view.getComputedStyle(parent)))
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
  const style = scroller.ownerDocument.defaultView!.getComputedStyle(scroller);
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
  const style = current.ownerDocument.defaultView!.getComputedStyle(current);
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
    const branchStyle = view.getComputedStyle(branch);
    const branchZ = zIndex(branchStyle);
    for (const sibling of parent.children) {
      if (sibling === branch) continue;
      const style = view.getComputedStyle(sibling);
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
      if (contains(current, hit)) return true;
      // Ancestors are evidence only for a simulated scroll destination,
      // never proof that the current root itself is exposed.
      if (
        scrolls.some(({ x, y }) => x !== 0 || y !== 0) &&
        contains(hit, current)
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
 * What blocks every click on `element` whatever covers it: the last opened
 * native modal when the root is not in one, else the root's inert ancestor.
 */
function blockingAncestor(element: Element): Element | undefined {
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

/** Package-internal: the measurement behind `observePomRoot`, over the root's element. */
export function measurePomRoot(element: Element): PomRootState {
  if (!element.isConnected || !element.ownerDocument.defaultView) return absent;
  const blocker = blockingAncestor(element);
  let present = false;
  let inTheWay: Element | undefined;
  for (const { source, bounds } of renderedBoxes(element)) {
    const layout = layoutAncestors(source);
    for (const alignment of alignments) {
      const shown = scrolledIntoView(source, bounds, layout, alignment);
      if (!shown) continue;
      if (blocker)
        return { present: true, available: false, obstruction: blocker };
      present = true;
      const reach = sampleReach(element, shown.rect, shown.scrolls);
      if (reach === true) return { present: true, available: true };
      inTheWay ??= reach;
    }
  }
  if (!present) return absent;
  return inTheWay
    ? { present, available: false, obstruction: inTheWay }
    : { present, available: false };
}

const alignments = [
  "current",
  "center",
  "start",
  "end",
] as const satisfies readonly ScrollAlignment[];

/**
 * The boxes a click on `element` could land in: its own, or for a root that
 * renders none (such as `display: contents`), its visible descendants'.
 */
function renderedBoxes(element: Element) {
  const view = element.ownerDocument.defaultView!;
  const rootRects = [...element.getClientRects()];
  return rootRects.length
    ? rootRects.map((bounds) => ({ source: element, bounds }))
    : [...element.querySelectorAll("*")].flatMap((source) => {
        const style = view.getComputedStyle(source);
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
  const view = document.defaultView!;
  const htmlStyle = view.getComputedStyle(document.documentElement);
  const bodyStyle = document.body && view.getComputedStyle(document.body);
  const viewport: Rect = {
    left: 0,
    top: 0,
    right: document.documentElement.clientWidth,
    bottom: document.documentElement.clientHeight,
  };
  let rect: Rect | undefined = {
    left: bounds.left,
    right: bounds.right,
    top: bounds.top,
    bottom: bounds.bottom,
  };
  const ownClip = clipBounds(source);
  if (ownClip === null) return undefined;
  if (ownClip) rect = clip(rect, ownClip, true, true);
  if (!rect) return undefined;
  const scrolls: Scroll[] = [];
  for (const ancestor of ancestors) {
    if (ancestor === document.documentElement) break;
    if (
      ancestor === document.body &&
      htmlStyle.overflowX === "visible" &&
      htmlStyle.overflowY === "visible"
    )
      continue;
    const style = view.getComputedStyle(ancestor);
    const box = ancestor.getBoundingClientRect();
    const width = (ancestor as HTMLElement).offsetWidth || box.width;
    const height = (ancestor as HTMLElement).offsetHeight || box.height;
    const scaleX = width ? box.width / width : 1;
    const scaleY = height ? box.height / height : 1;
    const port = {
      left: box.left + ancestor.clientLeft * scaleX,
      top: box.top + ancestor.clientTop * scaleY,
      right: box.left + (ancestor.clientLeft + ancestor.clientWidth) * scaleX,
      bottom: box.top + (ancestor.clientTop + ancestor.clientHeight) * scaleY,
    };
    const scroll = projectIntoPort(
      rect,
      port,
      ancestor,
      style.overflowX,
      style.overflowY,
      scaleX,
      scaleY,
      alignment
    );
    scrolls.push(scroll);
    rect = clip(
      rect,
      port,
      style.overflowX !== "visible",
      style.overflowY !== "visible"
    );
    if (!rect) break;
    const ancestorClip = clipBounds(ancestor);
    if (ancestorClip === null) {
      rect = undefined;
      break;
    }
    if (ancestorClip) rect = clip(rect, ancestorClip, true, true);
    if (!rect) break;
  }
  if (!rect) return undefined;

  const scroller = document.scrollingElement;
  if (scroller && !fixedToViewport) {
    const overflowX =
      htmlStyle.overflowX === "visible"
        ? (bodyStyle?.overflowX ?? "visible")
        : htmlStyle.overflowX;
    const overflowY =
      htmlStyle.overflowY === "visible"
        ? (bodyStyle?.overflowY ?? "visible")
        : htmlStyle.overflowY;
    scrolls.push(
      projectIntoPort(
        rect,
        viewport,
        scroller,
        overflowX === "visible" ? "auto" : overflowX,
        overflowY === "visible" ? "auto" : overflowY,
        1,
        1,
        alignment
      )
    );
  }
  rect = clip(rect, viewport, true, true);
  return rect && { rect, scrolls };
}
