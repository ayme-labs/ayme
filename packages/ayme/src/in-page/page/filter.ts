// Stryker disable all
// An element filter in the document: a selector matches, a function
// compiled from its source runs. The module keeps one compiled predicate per
// source, so a filter compiles once per document. Self-contained, like the
// rest of the page part: the install function closes over nothing.
import type { FilterData, InPageFilter } from "../../shared";

/** What checking a filter found: whether the registration may go on. */
export type FilterCheck =
  | { kind: "ok" }
  | { kind: "bad-selector"; message: string }
  | { kind: "reads"; identifier: string }
  | { kind: "not-a-function" }
  | { kind: "no-eval" };

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
 * Checks a filter as a registration does, before anything runs it: a selector
 * must parse; a function must compile as one and must not read a variable
 * from the code around it, which a call on the document's root shows as a
 * ReferenceError. A page that forbids `new Function` gives `no-eval`, and
 * the caller uses the function as it was passed.
 */
export function checkFilter(data: FilterData): FilterCheck {
  if ("live" in data) return { kind: "ok" };
  if ("selector" in data) {
    try {
      document.documentElement.matches(data.selector);
      return { kind: "ok" };
    } catch (error) {
      return {
        kind: "bad-selector",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (/^\s*class\b/.test(data.source)) return { kind: "not-a-function" };
  let predicate: unknown;
  try {
    predicate = new Function(`return (${data.source});`)();
  } catch (error) {
    if (error instanceof EvalError) return { kind: "no-eval" };
    return { kind: "not-a-function" };
  }
  if (typeof predicate !== "function") return { kind: "not-a-function" };
  try {
    (predicate as InPageFilter)(document.documentElement);
  } catch (error) {
    if (error instanceof EvalError) return { kind: "no-eval" };
    if (error instanceof ReferenceError) {
      const identifier = /^(\S+) is not defined$/.exec(error.message)?.[1];
      return { kind: "reads", identifier: identifier ?? error.message };
    }
  }
  return { kind: "ok" };
}
