/**
 * Marks an Inspector host mounted for dogfooding: the panel is then part of
 * the page agents see.
 */
export const INSPECTOR_DOGFOOD_ATTRIBUTE = "data-ayme-inspector-dogfood";

/**
 * Package-internal: the mark on the Inspector's host while the runtime
 * hit-tests what a click would reach under the panel; the Inspector's own
 * stylesheet then takes everything in it out of hit testing.
 */
export const INSPECTOR_HIT_TEST_THROUGH_ATTRIBUTE =
  "data-ayme-hit-test-through";

/** The host element Playwright adds under `<html>` to draw highlights in. */
const OVERLAY_HOST = "x-pw-glass";

const isOverlayHost = (node: Node) =>
  node instanceof Element && node.localName === OVERLAY_HOST;

/**
 * Package-internal: whether `records` are only marks of Ayme's and
 * Playwright's own on the page, which are no activity of it: the runtime's
 * hit-test marks on the Inspector's host, and Playwright's highlight overlay
 * host under `<html>` coming and going. An observer that took them for
 * activity would extend a settle wait, or measure, mark and probe without end.
 */
export function onlyOwnMarks(records: readonly MutationRecord[]): boolean {
  return (
    records.length > 0 &&
    records.every((record) =>
      record.type === "attributes"
        ? record.attributeName === INSPECTOR_HIT_TEST_THROUGH_ATTRIBUTE ||
          isOverlayHost(record.target)
        : record.type === "childList" &&
          record.addedNodes.length + record.removedNodes.length > 0 &&
          [...record.addedNodes, ...record.removedNodes].every(isOverlayHost)
    )
  );
}

/** Package-internal: the Inspector's host, unless it is mounted for dogfooding. */
export const INSPECTOR_HOST_SELECTOR = `[data-ayme-inspector-host]:not([${INSPECTOR_DOGFOOD_ATTRIBUTE}])`;
