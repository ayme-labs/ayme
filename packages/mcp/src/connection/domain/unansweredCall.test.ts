import { expect, it } from "vitest";

import { unansweredCallText } from "./unansweredCall";

it("tells the agent that the call's outcome is unknown", () => {
  expect(JSON.parse(unansweredCallText({ type: "stopped" }))).toMatchObject({
    error:
      "The Ayme MCP server stopped before the page answered, so the call's outcome is unknown.",
  });
});

it("gives the reconnected page's tools with a call its page left by reloading", () => {
  expect(
    JSON.parse(
      unansweredCallText({ type: "reloaded", url: "http://x/", tools: ["a"] })
    )
  ).toEqual({
    error:
      "The page reloaded before it answered, so the call's outcome is unknown.",
    settled: false,
    loading: "http://x/",
    tools: ["a"],
  });
});

it("leaves the reconnected page's tools out when asked to name none", () => {
  expect(
    JSON.parse(
      unansweredCallText(
        { type: "navigated", url: "http://x/", tools: ["a"] },
        false
      )
    )
  ).toEqual({
    error:
      "The page navigated to http://x/ before it answered, so the call's outcome is unknown.",
    settled: false,
    loading: "http://x/",
  });
});
