import { expect, it, vi } from "vitest";

import { loadAgentConnection, loadProcessConnection } from "./agentConnection";

vi.mock("@ayme-dev/mcp/client", () => {
  throw new Error('Cannot find package "@ayme-dev/mcp"');
});
vi.mock("@ayme-dev/mcp/process", () => {
  throw new Error('Cannot find package "@ayme-dev/mcp"');
});

it("names the package to install when the page client can't be loaded", async () => {
  await expect(loadAgentConnection()).rejects.toThrow(
    "The agentConnection option could not load @ayme-dev/mcp. Install it beside @ayme-dev/ayme"
  );
});

it("names the package to install when an App Process's side can't be loaded", async () => {
  await expect(loadProcessConnection()).rejects.toThrow(
    "The agentConnection option could not load @ayme-dev/mcp. Install it beside @ayme-dev/ayme"
  );
});
