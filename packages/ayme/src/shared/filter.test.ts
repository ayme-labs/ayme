import { describe, expect, it } from "vitest";

import { checkFilter, filterData, type FilterData } from "./filter";

/** A root that only answers `matches`, which a filter under test reads. */
const root = {
  matches: (selector: string) => selector === "button",
} as unknown as Element;

/** What the page does with the source it receives. */
const compiled = (data: FilterData) =>
  new Function(`return (${(data as { source: string }).source});`)() as (
    element: Element
  ) => boolean;

describe("a filter written in method syntax", () => {
  const written = {
    filter(element: Element) {
      return element.matches("button");
    },
  };

  it("passes the check and runs from the one normalized source", () => {
    const data = filterData(written.filter);

    expect(checkFilter(data, root)).toEqual({ kind: "ok" });
    expect(compiled(data)(root)).toBe(true);
  });

  it("is still refused when it reads a variable from the code around it", () => {
    const outer = "button";
    const reading = {
      filter(element: Element) {
        return element.matches(outer);
      },
    };

    expect(checkFilter(filterData(reading.filter), root)).toEqual({
      kind: "reads",
      identifier: "outer",
    });
  });

  it("leaves an arrow function and a function expression as they are", () => {
    const arrow = (element: Element) => element.matches("button");
    function named(element: Element) {
      return element.matches("button");
    }

    expect(filterData(arrow)).toEqual({ source: arrow.toString() });
    expect(filterData(named)).toEqual({ source: named.toString() });
  });

  it("does not turn a native function into a function", () => {
    expect(checkFilter(filterData(Math.max as never), root)).toEqual({
      kind: "not-a-function",
    });
  });
});
