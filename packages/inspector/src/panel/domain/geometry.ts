import type { Layout, Point, Preferences, Rect } from "./preferences";

export type Viewport = { width: number; height: number };

export type Dock = Exclude<Layout, "float">;

/** The room a docked panel takes from the host page, on its docked side. */
export type HostReservation = { dock: Dock; size: number };

/** The header's height: a floating panel always keeps it on the page. */
export const HEADER_HEIGHT = 50;
/** How much of a floating panel's width stays on the page, at least. */
const VISIBLE_WIDTH = 120;
const MIN_FLOAT = { width: 540, height: 520 };
const SIDE_WIDTH = { min: 540, max: 1000 };
const BOTTOM_HEIGHT = { min: 240, max: 640 };
/** Dropping the header this close to an edge docks the panel there. */
const SNAP_SIDE = 32;
const SNAP_BOTTOM = 40;

export const LOGO_SIZE = 48;
const LOGO_MARGIN = 16;

export function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(Math.max(low, high), value));
}

/**
 * The floating panel's first place: the page's top right, at its narrowest,
 * so it leaves the most of the page in view.
 */
export function defaultFloat(viewport: Viewport): Rect {
  const width = Math.min(MIN_FLOAT.width, viewport.width - 48);
  const height = Math.min(800, viewport.height - 48);
  return { x: viewport.width - width - 24, y: 24, width, height };
}

/**
 * Fits a floating panel to the viewport, keeping its header reachable. A
 * panel moved partly off the page keeps its header and 120px of its width on
 * it, but one whose size had to change to fit the viewport moves in until it
 * fits whole.
 */
export function fitFloat(rect: Rect, viewport: Viewport): Rect {
  const width = clamp(
    rect.width,
    Math.min(MIN_FLOAT.width, viewport.width),
    viewport.width
  );
  const height = clamp(
    rect.height,
    Math.min(MIN_FLOAT.height, viewport.height),
    viewport.height
  );
  const shown =
    width === rect.width && height === rect.height
      ? { width: VISIBLE_WIDTH, height: HEADER_HEIGHT }
      : { width, height };
  return {
    x: clamp(rect.x, shown.width - width, viewport.width - shown.width),
    y: clamp(rect.y, 0, viewport.height - shown.height),
    width,
    height,
  };
}

export type Side = "left" | "right" | "top" | "bottom";
export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
/** What the person drags to resize the panel: an edge or a corner. */
export type Handle = Side | Corner;

/**
 * Resizes a floating panel by dragging the given sides: one for an edge, two
 * for a corner. The opposite sides stay put, and the panel stays within the
 * viewport on the sides being dragged, even where the viewport is narrower
 * than the panel's minimum size.
 */
export function resizeFloat(
  start: Rect,
  sides: readonly Side[],
  delta: Point,
  viewport: Viewport
): Rect {
  let { x, y, width, height } = start;
  if (sides.includes("left")) {
    const right = start.x + start.width;
    width = clamp(
      start.width - delta.x,
      Math.min(MIN_FLOAT.width, right),
      right
    );
    x = right - width;
  }
  if (sides.includes("right"))
    width = clamp(
      start.width + delta.x,
      Math.min(MIN_FLOAT.width, viewport.width - start.x),
      viewport.width - start.x
    );
  if (sides.includes("top")) {
    const bottom = start.y + start.height;
    height = clamp(
      start.height - delta.y,
      Math.min(MIN_FLOAT.height, bottom),
      bottom
    );
    y = bottom - height;
  }
  if (sides.includes("bottom"))
    height = clamp(
      start.height + delta.y,
      Math.min(MIN_FLOAT.height, viewport.height - start.y),
      viewport.height - start.y
    );
  return { x, y, width, height };
}

function fitSideWidth(width: number, viewport: Viewport) {
  return clamp(
    width,
    Math.min(SIDE_WIDTH.min, viewport.width),
    Math.min(SIDE_WIDTH.max, viewport.width)
  );
}

function fitBottomHeight(height: number, viewport: Viewport) {
  return clamp(
    height,
    Math.min(BOTTOM_HEIGHT.min, viewport.height),
    Math.min(BOTTOM_HEIGHT.max, viewport.height - HEADER_HEIGHT)
  );
}

/** The panel's sizes in every layout, each fitted to the viewport. */
export type Sizes = { float: Rect; sideWidth: number; bottomHeight: number };

export function fitSizes(
  preferences: Pick<Preferences, "float" | "sideWidth" | "bottomHeight">,
  viewport: Viewport
): Sizes {
  return {
    float: fitFloat(preferences.float ?? defaultFloat(viewport), viewport),
    sideWidth: fitSideWidth(preferences.sideWidth, viewport),
    bottomHeight: fitBottomHeight(preferences.bottomHeight, viewport),
  };
}

/** The room a dock takes from the page: its width, or its height. */
export function dockSize(dock: Dock, sizes: Sizes) {
  return dock === "bottom" ? sizes.bottomHeight : sizes.sideWidth;
}

/**
 * Where a box sits: how far it is from each viewport edge it holds to, and
 * its size along any axis no two edges set. A docked panel holds to the
 * edges of the page it docks to, so it stays beside a scrollbar the
 * viewport's size counts in.
 */
export type Placement = Partial<Record<Side, number>> & {
  width?: number;
  height?: number;
};

export function placement(layout: Layout, sizes: Sizes): Placement {
  if (layout === "float") {
    const { x, y, width, height } = sizes.float;
    return { left: x, top: y, width, height };
  }
  if (layout === "bottom")
    return { left: 0, right: 0, bottom: 0, height: sizes.bottomHeight };
  return { [layout]: 0, top: 0, bottom: 0, width: sizes.sideWidth };
}

/** The same box, drawn in by this much from each of its sides. */
export function inset(box: Placement, by: number): Placement {
  const inner: Placement = {};
  for (const side of ["left", "right", "top", "bottom"] as const)
    if (box[side] !== undefined) inner[side] = box[side] + by;
  if (box.width !== undefined) inner.width = box.width - 2 * by;
  if (box.height !== undefined) inner.height = box.height - 2 * by;
  return inner;
}

/**
 * The point the panel grows out of the logo from, and shrinks back into it
 * toward: the logo's centre, from the panel's top left corner.
 */
export function growOrigin(
  layout: Layout,
  sizes: Sizes,
  logo: Point,
  viewport: Viewport
): Point {
  const {
    left,
    top,
    right = 0,
    bottom = 0,
    width = 0,
    height = 0,
  } = placement(layout, sizes);
  // Where its right and bottom edges are.
  // Stryker disable next-line ArithmeticOperator: a panel placed from its right or bottom edge holds to it at 0.
  const far = { x: viewport.width - right, y: viewport.height - bottom };
  const corner = { x: left ?? far.x - width, y: top ?? far.y - height };
  return {
    x: logo.x + LOGO_SIZE / 2 - corner.x,
    y: logo.y + LOGO_SIZE / 2 - corner.y,
  };
}

/**
 * Where a panel floats while its header is dragged, from where it showed
 * when it was pressed: with the pointer as far along its width as it took
 * hold of the panel, and as far down. A floating panel shows at its own
 * width, so it moves with the pointer; a docked one floats at the floating
 * width, under the pointer.
 */
export function dragFloat(
  shown: Rect,
  press: Point,
  delta: Point,
  float: Rect,
  viewport: Viewport
): Rect {
  const along = (press.x - shown.x) / shown.width;
  const start = { x: press.x - along * float.width, y: shown.y };
  return fitFloat(
    { ...float, x: start.x + delta.x, y: start.y + delta.y },
    viewport
  );
}

/**
 * The sizes a resize handle dragged this far gives a panel in this layout.
 * A floating panel resizes from the handle's sides; a docked one from its
 * one edge facing the page, which grows the dock as it moves away from it.
 */
export function resize(
  layout: Layout,
  handle: Handle,
  sizes: Sizes,
  delta: Point,
  viewport: Viewport
): Partial<Sizes> {
  if (layout === "float")
    return {
      float: resizeFloat(
        sizes.float,
        handle.split("-") as Side[],
        delta,
        viewport
      ),
    };
  if (layout === "bottom")
    return {
      bottomHeight: fitBottomHeight(sizes.bottomHeight - delta.y, viewport),
    };
  return {
    sideWidth: fitSideWidth(
      sizes.sideWidth + (layout === "left" ? delta.x : -delta.x),
      viewport
    ),
  };
}

/** The dock a header dropped at this pointer position lands in, if any. */
export function dockAt(pointer: Point, viewport: Viewport): Dock | undefined {
  if (pointer.x < SNAP_SIDE) return "left";
  if (pointer.x > viewport.width - SNAP_SIDE) return "right";
  if (pointer.y > viewport.height - SNAP_BOTTOM) return "bottom";
  return undefined;
}

/** The logo's first place: the page's bottom right. */
export function defaultLogo(viewport: Viewport): Point {
  return fitLogo({ x: Infinity, y: Infinity }, viewport);
}

export function fitLogo(point: Point, viewport: Viewport): Point {
  return {
    x: clamp(point.x, LOGO_MARGIN, viewport.width - LOGO_SIZE - LOGO_MARGIN),
    y: clamp(point.y, LOGO_MARGIN, viewport.height - LOGO_SIZE - LOGO_MARGIN),
  };
}
