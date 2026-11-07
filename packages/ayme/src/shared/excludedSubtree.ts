/**
 * The mark of an excluded subtree: an element that carries it, and everything
 * under it, is no part of the page Ayme reads and acts on. Capture leaves it
 * out, Reach looks through it, picking and Demo Mode's pass-through let it be,
 * and screenshots hide it. Any client sets it on its own DOM, as the inline
 * Inspector does on its host.
 */
export const EXCLUDE_ATTRIBUTE = "data-ayme-exclude";

/** Package-internal: the elements that carry the mark. */
export const EXCLUDED_SUBTREE_SELECTOR = `[${EXCLUDE_ATTRIBUTE}]`;

/**
 * Package-internal: the mark on an excluded subtree's root while the runtime
 * hit-tests what a click would reach under it, or lets pointer actions
 * through it; a client's own stylesheet then takes everything in it out of
 * hit testing.
 */
export const HIT_TEST_THROUGH_ATTRIBUTE = "data-ayme-hit-test-through";

/** The host element Playwright adds under `<html>` to draw highlights in. */
const OVERLAY_HOST = "x-pw-glass";

const isOverlayHost = (node: Node) =>
  node instanceof Element && node.localName === OVERLAY_HOST;

/**
 * Package-internal: whether `records` are only marks of Ayme's and
 * Playwright's own on the page, which are no activity of it: the runtime's
 * hit-test marks on an excluded subtree, and Playwright's highlight overlay
 * host under `<html>` coming and going. An observer that took them for
 * activity would extend a settle wait, or measure, mark and probe without end.
 */
export function onlyOwnMarks(records: readonly MutationRecord[]): boolean {
  return (
    records.length > 0 &&
    records.every((record) =>
      record.type === "attributes"
        ? record.attributeName === HIT_TEST_THROUGH_ATTRIBUTE ||
          isOverlayHost(record.target)
        : record.type === "childList" &&
          record.addedNodes.length + record.removedNodes.length > 0 &&
          [...record.addedNodes, ...record.removedNodes].every(isOverlayHost)
    )
  );
}
