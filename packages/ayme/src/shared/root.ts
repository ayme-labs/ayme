// What one probe of a Page Object Root finds, as every host reads it: plain
// data, so it crosses into Node as it is (ADR-0049).

/** What one probe of a Page Object Root's Locator found. */
export type RootState = {
  /** How many elements the Locator matched. */
  count: number;
  /**
   * Whether the root is on the page: the Locator matched one element, which
   * shows.
   */
  present: boolean;
  /** Whether a click would reach the root. */
  available: boolean;
  /** The Structural Ref of the one element matched, present or not. */
  ref?: string;
  /**
   * For a present root a click would not reach, what an Availability Reason
   * may name as in the way, by Structural Ref, nearest first.
   */
  inTheWay: string[];
};
