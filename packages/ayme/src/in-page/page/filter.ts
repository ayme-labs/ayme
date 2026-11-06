// Stryker disable all
// An element filter in the document: a selector matches, a function
// compiled from its source runs. The module keeps one compiled predicate per
// source, so a filter compiles once per document. Self-contained, like the
// rest of the page part: the install function closes over nothing.
import type { FilterData, InPageFilter } from "../../shared";

const compiled = new Map<string, InPageFilter>();

/** The predicate a filter names, compiled from its source on first use. */
export function compileFilter(data: FilterData): InPageFilter {
  if ("selector" in data) return (element) => element.matches(data.selector);
  if ("live" in data) return data.live;
  let predicate = compiled.get(data.source);
  if (!predicate) {
    predicate = new Function(`return (${data.source});`)() as InPageFilter;
    compiled.set(data.source, predicate);
  }
  return predicate;
}
