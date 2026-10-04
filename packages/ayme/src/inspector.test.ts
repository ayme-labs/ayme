import { expect, it, vi } from "vitest";

import { loadInspector } from "./inspector";

vi.mock("@ayme-dev/inspector", () => {
  throw new Error('Cannot find package "@ayme-dev/inspector"');
});

it("names the package to install when the Inspector can't be loaded", async () => {
  await expect(loadInspector()).rejects.toThrow(
    "The inspector option could not load @ayme-dev/inspector. Install it beside @ayme-dev/ayme"
  );
});
