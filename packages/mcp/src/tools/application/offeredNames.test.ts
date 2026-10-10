import { expect, it } from "vitest";

import { AgentConnection } from "../../connection";
import { rememberOfferedNames } from "./offeredNames";

it("remembers a tool name after the tool went", () => {
  const connection = new AgentConnection();
  const wasOffered = rememberOfferedNames(connection);
  const process = connection.attachProcess({ process: "server" });

  process.publishTools([
    {
      name: "peek.node.jobs",
      description: "",
      inputSchema: {},
      available: true,
    },
  ]);
  process.publishTools([]);

  expect(connection.offers("peek.node.jobs")).toBe(false);
  expect(wasOffered("peek.node.jobs")).toBe(true);
  expect(wasOffered("peek.node.mail")).toBe(false);
});
