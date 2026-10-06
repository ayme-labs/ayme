import { expect, it } from "vitest";

import { mergeToolOffers } from "./toolOffers";

const tool = (name: string, description = "") => ({
  name,
  description,
  inputSchema: {},
});

it("lists every connection's tools, in the order the offers come", () => {
  const { shown, hidden } = mergeToolOffers([
    { owner: "page", tools: [tool("snapshot"), tool("peek.cart")] },
    { owner: "worker", tools: [tool("peek.node.jobs")] },
  ]);

  expect(shown.map(({ tool, owner }) => [tool.name, owner])).toEqual([
    ["snapshot", "page"],
    ["peek.cart", "page"],
    ["peek.node.jobs", "worker"],
  ]);
  expect(hidden).toEqual([]);
});

it("keeps the first offer of a name and hides the later ones, saying who keeps it", () => {
  const { shown, hidden } = mergeToolOffers([
    { owner: "server", tools: [tool("peek.node.jobs", "server's")] },
    { owner: "worker", tools: [tool("peek.node.jobs", "worker's")] },
  ]);

  expect(shown).toEqual([
    { tool: tool("peek.node.jobs", "server's"), owner: "server" },
  ]);
  expect(hidden).toEqual([
    { name: "peek.node.jobs", owner: "worker", keptBy: "server" },
  ]);
});
