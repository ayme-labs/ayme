import { expect, it } from "vitest";

import { unansweredCallText } from "./unansweredCall";

it("tells the agent that the call's outcome is unknown", () => {
  expect(JSON.parse(unansweredCallText({ type: "stopped" }))).toMatchObject({
    error:
      "The ayme MCP server stopped before the page answered, so the call's outcome is unknown.",
  });
});

it("gives the reloaded page's URL with a call its page left by reloading", () => {
  expect(
    JSON.parse(
      unansweredCallText({ type: "reloaded", url: "http://x/", tools: ["a"] })
    )
  ).toEqual({
    error:
      "The page reloaded before it answered, so the call's outcome is unknown.",
    settled: false,
    url: "http://x/",
  });
});
