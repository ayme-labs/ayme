import { expect, it } from "vitest";

import { readableResult } from "./readableResult";

// Unit tests: a run's result as Runs shows it.

it("shows a result without multi-line strings as indented JSON", () => {
  const value = {
    added: "Milk",
    items: [1, { total: 2 }],
    empty: {},
    none: [],
  };
  const json = JSON.stringify(value);

  expect(readableResult(json)).toBe(JSON.stringify(value, null, 2));
});

it("shows a multi-line string as its lines, indented under its key", () => {
  const json = JSON.stringify({
    structure: '- e5:\n  - main "Playground"',
    count: 1,
  });

  expect(readableResult(json)).toBe(
    [
      "{",
      '  "structure":',
      "    - e5:",
      '      - main "Playground"',
      '  "count": 1',
      "}",
    ].join("\n")
  );
});

it("shows a multi-line string in a list as its lines at the item's indent", () => {
  expect(readableResult(JSON.stringify(["a\n\nb", "c"]))).toBe(
    ["[", "  a", "", "  b", '  "c"', "]"].join("\n")
  );
});

it("shows a multi-line string result as its lines", () => {
  expect(readableResult(JSON.stringify("a\nb"))).toBe("a\nb");
});

it("shows a result that isn't JSON as it is", () => {
  expect(readableResult("not json")).toBe("not json");
});
