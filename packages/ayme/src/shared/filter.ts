// An element filter as the runtime's options take it, and as the In-page
// Module receives it: plain data, so it crosses into the document (ADR-0049).
// A selector is data already. A function is sent by its source: it runs in
// the page on its own, so it must be self-contained.

/**
 * A function the page runs over an element, to keep it or leave it out. It
 * runs in the page, serialized by its source, so it must be self-contained:
 * it may read its own arguments and the page's globals, and nothing from the
 * code around it. A function that reads a variable from that code is
 * rejected when it is registered.
 */
export type InPageFilter = (element: Element) => boolean;

/** A CSS selector, which matches an element, or a function that runs in the page. */
export type ElementFilter = string | InPageFilter;

/**
 * An element filter as the In-page Module receives it. `live` is the
 * function itself, for a page that forbids `new Function` (a Content Security
 * Policy without `unsafe-eval`), in the browser lane only.
 */
export type FilterData =
  { selector: string } | { source: string } | { live: InPageFilter };

/** A filter that a Custom Tool's refs are captured under, by the tool's name. */
export type NamedFilter = { name: string; filter: FilterData };

/** The filter as data: a selector, or the function's source, which the page compiles. */
export function filterData(filter: ElementFilter): FilterData {
  return typeof filter === "string"
    ? { selector: filter }
    : { source: filter.toString() };
}
