import { expect, it } from "vitest";

import { listedTools } from "./listedTools";

const schema = { type: "object", properties: {}, additionalProperties: false };

it("lists the Page Object Tools alone, each with what an agent reads of it", () => {
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
        authorDescription: "Read the heading.",
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
      },
      {
        name: "click",
        group: "browser",
        inputSchema: schema,
        available: true,
      },
    ])
  ).toEqual([
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
    },
  ]);
});
