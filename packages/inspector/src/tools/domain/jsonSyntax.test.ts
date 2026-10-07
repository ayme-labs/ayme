import { describe, expect, it } from "vitest";

import { jsonSyntaxError } from "./jsonSyntax";

describe("jsonSyntaxError", () => {
  it("finds nothing wrong in JSON", () => {
    for (const text of [
      '{ "a": [1, -2.5e3, true, false, null], "b": { "c": "\\u00e9\\n" } }',
      "  []  ",
      '"text"',
      "0",
    ])
      expect(jsonSyntaxError(text)).toBeUndefined();
  });

  it.each([
    ["{x}", 1, 2, "expected a property name in double quotes, found 'x'"],
    ['{"a":}', 1, 6, "expected a value, found '}'"],
    ["[1,]", 1, 4, "expected a value, found ']'"],
    ['{"a": tru}', 1, 7, "expected a value, found 't'"],
    ['{"a": 1} x', 1, 10, "expected the end of the text, found 'x'"],
    ["[\n  1\n  2\n]", 3, 3, "expected ',' or ']', found '2'"],
    ["", 1, 1, "expected a value, found the end of the text"],
    ['"\\x"', 1, 3, "expected an escape character, found 'x'"],
  ])("places the error in %j", (text, line, column, message) => {
    expect(jsonSyntaxError(text)).toEqual({ line, column, message });
  });

  it("takes only JSON's whitespace, so a leading BOM is an error", () => {
    expect(jsonSyntaxError('\uFEFF{"a": 1}')).toEqual({
      line: 1,
      column: 1,
      message: "expected a value, found '\uFEFF'",
    });
    expect(jsonSyntaxError('{"a":\u00A01}')).toBeDefined();
  });

  it("finds an error wherever JSON.parse fails", () => {
    for (const text of ["{x}", "[1,]", "01", "-", "1.", '{"a":1,}', "nul"])
      expect(jsonSyntaxError(text), text).toBeDefined();
  });
});
