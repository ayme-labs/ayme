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

/**
 * Package-internal: whether `records` are only the runtime's own hit-test
 * marks on the Inspector's host, which are no activity of the page: an
 * observer that took them for one would measure, mark and probe without end.
 */
export function onlyHitTestMarks(records: readonly MutationRecord[]): boolean {
  return (
    records.length > 0 &&
    records.every(
      (record) =>
        record.type === "attributes" &&
        record.attributeName === INSPECTOR_HIT_TEST_THROUGH_ATTRIBUTE
    )
  );
}

/** Package-internal: the Inspector's host, unless it is mounted for dogfooding. */
export const INSPECTOR_HOST_SELECTOR = `[data-ayme-inspector-host]:not([${INSPECTOR_DOGFOOD_ATTRIBUTE}])`;
