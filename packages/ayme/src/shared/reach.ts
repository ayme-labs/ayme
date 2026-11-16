// What the In-page Module measures of one element's reach (ADR-0041), as
// every host reads it: plain data, the elements it names given by Structural
// Ref, so it crosses into Node as it is (ADR-0049).

/**
 * What the layout shows of one element, measured without scrolling or
 * sending input: `present` while some part of it shows, or would once its
 * scroll containers and the viewport scrolled to it; `available` while a
 * click would reach it; and, for a present element a click would not reach,
 * what stopped it. `blocker` is the open native modal the element is not in
 * or its inert ancestor, or the ancestor a modal layer hid it behind, which
 * blocks every click; else `hit` is the element the click would hit instead
 * and its ancestors up to the first that holds the element, nearest first.
 * Each is named by its Structural Ref, a synthetic one for an element with
 * no node of its own.
 */
export type ReachMeasurement = {
  present: boolean;
  available: boolean;
  blocker?: string;
  hit?: readonly string[];
};
