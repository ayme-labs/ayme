// What the In-page Module measures of one element's reach (ADR-0041), as
// every host reads it: plain data, so it crosses into Node as it is
// (ADR-0049).

/**
 * What the layout shows of one element, measured without scrolling or
 * sending input: `present` while some part of it shows, or would once its
 * scroll containers and the viewport scrolled to it; `available` while a
 * click would reach it; and, for a present element a click would not reach,
 * `inTheWay`, what an Availability Reason names as in the way of it. That is
 * the open native modal the element is not in or its inert ancestor, or the
 * ancestor a modal layer hid it behind, which blocks every click; else the
 * nearest of the element the click would hit instead and its ancestors up to
 * the first that holds the element. It is named by its role and accessible
 * name, as `dialog "Delete"`, or its role alone when it has no name; it is
 * left out when what is in the way has no role but generic, none or
 * presentation, or no snapshot shows it: the document element, or one
 * hidden from the accessibility tree.
 */
export type ReachMeasurement = {
  present: boolean;
  available: boolean;
  inTheWay?: string;
};
