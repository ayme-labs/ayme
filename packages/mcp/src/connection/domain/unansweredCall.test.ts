import { expect, it } from "vitest";

import { unansweredCallText } from "./unansweredCall";

it("tells the agent that the call's outcome is unknown", () => {
  expect(JSON.parse(unansweredCallText({ type: "stopped" }))).toMatchObject({
    error:
      "The Ayme MCP server stopped before the page answered, so the call's outcome is unknown.",
  });
});
