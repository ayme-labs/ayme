import { describe, expect, it } from "vitest";
import { joinAdjacentText } from "./joinAdjacentText";

describe("joinAdjacentText", () => {
  it("joins runs of strings and leaves nodes between them", () => {
    expect(joinAdjacentText(["a", "b", 1, "c", 2, 3, "d", "e", "f"])).toEqual([
      "ab",
      1,
      "c",
      2,
      3,
      "def",
    ]);
  });

  it("keeps a list without adjacent strings as it is", () => {
    expect(joinAdjacentText(["a", 1, "b"])).toEqual(["a", 1, "b"]);
    expect(joinAdjacentText([])).toEqual([]);
  });
});
