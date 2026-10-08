import { expect, it, vi } from "vitest";

import { loadWebMcpPublication } from "./webMcp";

vi.mock("@ayme-dev/webmcp", () => {
  throw new Error('Cannot find package "@ayme-dev/webmcp"');
});

it("names the package to install when WebMCP publication can't be loaded", async () => {
  await expect(loadWebMcpPublication()).rejects.toThrow(
    "The webMCP option could not load @ayme-dev/webmcp. Install it beside @ayme-dev/ayme"
  );
});
