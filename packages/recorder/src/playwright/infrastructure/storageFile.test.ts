import { describe, expect, it } from "vitest";

import { storageStateIn } from "./storageFile";

// A --load-storage file is read before the browser opens. It must hold a
// storage state, a JSON object as Playwright writes one: Playwright takes a
// string for the path of another file, and null for no storage state at all.
describe("the storage state in a file's text", () => {
  it("is the JSON object the file holds", () => {
    const state = {
      cookies: [{ name: "session", value: "s3cret" }],
      origins: [],
    };

    expect(storageStateIn(JSON.stringify(state))).toEqual(state);
  });

  it.each([
    { text: '"other.json"', holds: "a string" },
    { text: "null", holds: "null" },
    { text: "[]", holds: "an array" },
    { text: "42", holds: "a number" },
  ])("is no storage state when the file holds $holds", ({ text, holds }) => {
    expect(() => storageStateIn(text)).toThrow(
      `it holds ${holds}, not a storage state object.`
    );
  });

  it("is no storage state when the file is not JSON", () => {
    expect(() => storageStateIn("cookies")).toThrow(SyntaxError);
  });
});
