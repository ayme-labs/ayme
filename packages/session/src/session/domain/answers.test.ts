import { expect, it } from "vitest";

import { paramsNotJson, paramsUnreadable, unanswerable } from "./answers";

// The sentences the process answers with, for what went wrong outside the
// Session: each takes why from an error's message and ends it with its own
// full stop.

it("--params that is not JSON is answered with the parser's reason, its own dots kept and its full stop not doubled", () => {
  expect(
    paramsNotJson(`Unexpected token 'a', "a.b" is not valid JSON`, "default")
  ).toEqual({
    ok: false,
    text: `--params is not JSON: Unexpected token 'a', "a.b" is not valid JSON. Give the tool's input as one JSON object, as ayme -s=default tools prints its parameters.`,
  });
  expect(paramsNotJson("Unexpected end of JSON input.", "default")).toEqual({
    ok: false,
    text: "--params is not JSON: Unexpected end of JSON input. Give the tool's input as one JSON object, as ayme -s=default tools prints its parameters.",
  });
});

it("a --params file that cannot be read is answered with why, its own dots kept and its full stop not doubled", () => {
  expect(
    paramsUnreadable(
      "input.json",
      "ENOENT: no such file or directory, open 'input.json'"
    )
  ).toEqual({
    ok: false,
    text: "--params @input.json names a file ayme cannot read: ENOENT: no such file or directory, open 'input.json'.",
  });
  expect(paramsUnreadable("input.json", "The file is locked.")).toEqual({
    ok: false,
    text: "--params @input.json names a file ayme cannot read: The file is locked.",
  });
});

it("an answer that cannot be written says why, its own dots kept and its full stop not doubled", () => {
  expect(unanswerable("Basket.items.toJSON threw: no items.")).toEqual({
    ok: false,
    text: "ayme could not write the answer to this command: Basket.items.toJSON threw: no items.",
  });
});
