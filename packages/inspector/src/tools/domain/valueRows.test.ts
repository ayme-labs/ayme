import { expect, it } from "vitest";

import { guessedType, readRows } from "./valueRows";

// Unit tests: which values of a map of strings or numbers read as numbers.

const both = ["string", "number"] as const;

it.each(["2", "-3", "0", "12", "2.5", "2.55", " 7 "])(
  "guesses %j is a number",
  (value) => {
    expect(guessedType(value, both)).toBe("number");
  }
);

it.each(["02134", "+3", "1e3", "1a", "2.x", "2.", ".5", ""])(
  "guesses %j is a string",
  (value) => {
    expect(guessedType(value, both)).toBe("string");
  }
);

it("sends a number row as the number it reads as, and flags one that isn't", () => {
  expect(
    readRows(
      [
        { label: "count", value: "12.25", fixed: "number" },
        { label: "id", value: "1a", fixed: "number" },
      ],
      both
    )
  ).toEqual({
    values: { count: 12.25 },
    problems: [undefined, "Not a number."],
  });
});
