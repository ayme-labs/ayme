import { clamp } from "./geometry";
import type { Layout, RegionSizes } from "./preferences";

/** The body and its regions as laid out now, in pixels. */
export type BodyMeasure = {
  width: number;
  height: number;
  navigatorWidth: number;
  runsWidth: number;
  runsHeight: number;
};

/** A region's size and the range its divider moves it in. */
export type RegionRange = { value: number; min: number; max: number };

const NAVIGATOR_MIN = 200;
/** What the detail pane keeps, at least, beside the navigator. */
const DETAIL_MIN = 280;
const RUNS_MIN_HEIGHT = 120;
/** What the navigator and detail keep, at least, above Runs. */
const BODY_MIN_HEIGHT = 160;
const RUNS_MIN_WIDTH = 240;

/**
 * Each region's size and range, from the sizes the person set (fitted to
 * the room the body has now) or else the size the layout gives it.
 * Docked to the bottom, Runs is a column, so it has a width, not a height.
 */
export function regionRanges(
  sizes: RegionSizes,
  measure: BodyMeasure,
  layout: Layout
) {
  const runsColumn = layout === "bottom";
  // Until the body is laid out there's no room to fit to.
  const measured = measure.width > 0;
  const fit = (
    set: number | undefined,
    laidOut: number,
    min: number,
    max: number
  ): RegionRange => {
    const high = measured ? Math.max(min, max) : Number.MAX_SAFE_INTEGER;
    return { value: clamp(set ?? laidOut, min, high), min, max: high };
  };
  const runsWidth = fit(
    runsColumn ? sizes.runsWidth : undefined,
    measure.runsWidth,
    RUNS_MIN_WIDTH,
    measure.width -
      (sizes.navigatorWidth ?? measure.navigatorWidth) -
      DETAIL_MIN
  );
  const navigator = fit(
    sizes.navigatorWidth,
    measure.navigatorWidth,
    NAVIGATOR_MIN,
    measure.width - (runsColumn ? runsWidth.value : 0) - DETAIL_MIN
  );
  const runs: RegionRange = runsColumn
    ? runsWidth
    : fit(
        sizes.runsHeight,
        measure.runsHeight,
        RUNS_MIN_HEIGHT,
        measure.height - BODY_MIN_HEIGHT
      );
  return { navigator, runs };
}
