import { describe, expect, it } from "vitest";

import { inspectCommand } from "./inspectCommand";

const installed = async () => true;

describe("inspectCommand", () => {
  it("prints the Inspector's URL on the running server", async () => {
    expect(
      await inspectCommand({
        installed,
        servers: async () => ["ws://127.0.0.1:9351"],
      })
    ).toEqual({ ok: true, text: "http://127.0.0.1:9351/inspector\n" });
  });

  it("prints one URL per running server, in port order", async () => {
    expect(
      await inspectCommand({
        installed,
        servers: async () => ["ws://127.0.0.1:9350", "ws://127.0.0.1:9352"],
      })
    ).toEqual({
      ok: true,
      text: "http://127.0.0.1:9350/inspector\nhttp://127.0.0.1:9352/inspector\n",
    });
  });

  it("says to install @ayme-dev/inspector when it is missing, before it looks for a server", async () => {
    let looked = false;
    const result = await inspectCommand({
      installed: async () => false,
      servers: async () => ((looked = true), ["ws://127.0.0.1:9351"]),
    });

    expect(result.ok).toBe(false);
    expect(result.text).toContain("npm install --save-dev @ayme-dev/inspector");
    expect(looked).toBe(false);
  });

  it("says no server runs when none answers", async () => {
    const result = await inspectCommand({ installed, servers: async () => [] });

    expect(result.ok).toBe(false);
    expect(result.text).toContain("No Ayme MCP server is running");
  });
});
