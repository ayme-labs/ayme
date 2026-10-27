/**
 * Test support: the Reach adapter of unit tests, which have no layout to
 * measure. Chromium's geometry is covered by the browser tests.
 */
import type { Reach, ReachMeasurement } from "../page-state";

const reached: ReachMeasurement = { present: true, available: true };

/**
 * A layout where every element is present and every click reaches it;
 * nothing blocks. `overrides` measures another layout, method by method.
 */
export function alwaysReaches(overrides: Partial<Reach> = {}): Reach {
  return {
    measurePomRoot: async () => reached,
    measureReach: () => reached,
    measureReachAtCall: async () => reached,
    blockingAncestor: () => undefined,
    inReachBatch: (measureAll) => measureAll(),
    ...overrides,
  };
}
