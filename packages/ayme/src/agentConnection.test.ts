import { expect, it, vi } from "vitest";

import { loadAgentConnection, loadProcessConnection } from "./agentConnection";

vi.mock("@ayme-dev/mcp/client", () => {
  throw new Error('Cannot find package "@ayme-dev/mcp"');
});
vi.mock("@ayme-dev/mcp/process", () => {
  throw new Error('Cannot find package "@ayme-dev/mcp"');
});

it("names the package when the page client can't be loaded", async () => {
  await expect(loadAgentConnection()).rejects.toThrow(
    "The agentConnection option could not load @ayme-dev/mcp. Cause:"
  );
});

it("names the package when an App Process's side can't be loaded", async () => {
  await expect(loadProcessConnection()).rejects.toThrow(
    "The agentConnection option could not load @ayme-dev/mcp. Cause:"
  );
});
