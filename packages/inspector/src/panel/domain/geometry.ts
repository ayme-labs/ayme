import type { Layout, Point, Rect } from "./preferences";

export type Viewport = { width: number; height: number };

export type Dock = Exclude<Layout, "float">;

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

/** Fits a floating panel to the viewport, keeping its header reachable. */
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
  return {
    x: clamp(rect.x, VISIBLE_WIDTH - width, viewport.width - VISIBLE_WIDTH),
    y: clamp(rect.y, 0, viewport.height - HEADER_HEIGHT),
    width,
    height,
  };
}

/** Resizes a floating panel from its left edge; its right edge stays put. */
export function resizeFloatLeft(start: Rect, deltaX: number): Rect {
  const right = start.x + start.width;
  const width = clamp(start.width - deltaX, MIN_FLOAT.width, right);
  return { ...start, x: right - width, width };
}

/** Resizes a floating panel from its bottom edge. */
export function resizeFloatBottom(
  start: Rect,
  deltaY: number,
  viewport: Viewport
): Rect {
  return {
    ...start,
    height: clamp(
      start.height + deltaY,
      MIN_FLOAT.height,
      viewport.height - start.y
    ),
  };
}

export function fitSideWidth(width: number, viewport: Viewport) {
  return clamp(
    width,
    Math.min(SIDE_WIDTH.min, viewport.width),
    Math.min(SIDE_WIDTH.max, viewport.width)
  );
}

export function fitBottomHeight(height: number, viewport: Viewport) {
  return clamp(
    height,
    Math.min(BOTTOM_HEIGHT.min, viewport.height),
    Math.min(BOTTOM_HEIGHT.max, viewport.height - HEADER_HEIGHT)
  );
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
