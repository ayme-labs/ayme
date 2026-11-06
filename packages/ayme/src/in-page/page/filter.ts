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

/**
 * `predicate` as a capture runs it for the registration `label`. A filter
 * that reads a variable from the code around it, on a branch the
 * registration's one check did not take, throws a ReferenceError here; it
 * comes out naming the registration and the identifier, in the form the host
 * reads (`filterFailure`). Any other error goes on as it is.
 */
export function guarded(label: string, predicate: InPageFilter): InPageFilter {
  return (element) => {
    try {
      return predicate(element);
    } catch (error) {
      const identifier = /^(\S+) is not defined$/.exec(
        (error as Error).message
      )?.[1];
      if (error instanceof ReferenceError && identifier)
        throw new Error(`ayme-filter-reads:${identifier}:${label}`, {
          cause: error,
        });
      throw error;
    }
  };
}
