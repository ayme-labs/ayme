import { expect, it } from "vitest";

import { listedTools } from "./listedTools";

const schema = { type: "object", properties: {}, additionalProperties: false };

it("lists the Page Object Tools alone, each with what an agent reads of it and whether its author marked it destructive, and nothing of what a tool does not say", () => {
  expect(
    listedTools([
      {
        name: "page_objects",
        group: "agent",
        agentDescription: "Returns the Page Objects on the page.",
        inputSchema: schema,
        available: true,
      },
      {
        name: "Basket.readHeading",
        group: "pageObject",
        agentDescription: "Read the heading. Afterwards the page shows Basket.",
        inputSchema: schema,
        available: true,
      },
      {
        name: "Basket.clear",
        group: "pageObject",
        inputSchema: schema,
        available: false,
        reason: "The basket is empty",
        destructive: true,
      },
      {
        name: "click",
        group: "browser",
        inputSchema: schema,
        available: true,
      },
    ])
  ).toStrictEqual([
    {
      name: "Basket.readHeading",
      description: "Read the heading. Afterwards the page shows Basket.",
      parameters: schema,
      available: true,
    },
    {
      name: "Basket.clear",
      parameters: schema,
      available: false,
      reason: "The basket is empty",
      destructive: true,
    },
  ]);
});
