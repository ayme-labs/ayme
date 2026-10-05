import { expect, it, vi } from "vitest";

import { loadAgentConnection } from "./agentConnection";

vi.mock("@ayme-dev/mcp/client", () => {
  throw new Error('Cannot find package "@ayme-dev/mcp"');
});

it("names the package to install when the page client can't be loaded", async () => {
  await expect(loadAgentConnection()).rejects.toThrow(
    "The agentConnection option could not load @ayme-dev/mcp. Install it beside @ayme-dev/ayme"
  );
});
