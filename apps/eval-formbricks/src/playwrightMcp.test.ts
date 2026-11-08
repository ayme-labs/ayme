import net from "node:net";

import { describe, expect, it } from "vitest";

import {
  cdpEndpoint,
  freeLoopbackPort,
  playwrightMcpServer,
  playwrightMcpVersion,
} from "./playwrightMcp.ts";

const context = {
  profileDir: "/run/browser-profile",
  outputDir: "/run/playwright-output",
  initPagePath: "/run/init-page.cjs",
};

describe("the Playwright MCP server entry", () => {
  it("launches the system Chrome, headless, on the prepared profile, without the page's WebMCP tools", () => {
    const server = playwrightMcpServer(context);
    expect(server.command).toBe(process.execPath);
    expect(server.args[0]).toMatch(/@playwright\/mcp\/cli\.js$/);
    expect(server.args.slice(1)).toEqual([
      "--browser",
      "chrome",
      "--headless",
      "--user-data-dir",
      "/run/browser-profile",
      "--no-webmcp",
      "--output-dir",
      "/run/playwright-output",
      "--init-page",
      "/run/init-page.cjs",
    ]);
  });

  it("attaches to a browser over CDP instead, with no browser, profile or headless switch, keeping the rest", () => {
    const server = playwrightMcpServer(context, {
      cdpEndpoint: "http://127.0.0.1:9222",
    });
    expect(server.command).toBe(process.execPath);
    expect(server.args[0]).toMatch(/@playwright\/mcp\/cli\.js$/);
    expect(server.args.slice(1)).toEqual([
      "--cdp-endpoint",
      "http://127.0.0.1:9222",
      "--no-webmcp",
      "--output-dir",
      "/run/playwright-output",
      "--init-page",
      "/run/init-page.cjs",
    ]);
  });

  it("is pinned to an exact version", () => {
    expect(playwrightMcpVersion()).toBe("0.0.83");
  });
});

describe("the remote-debugging port", () => {
  it("is a free loopback port, named as an HTTP endpoint", async () => {
    const port = await freeLoopbackPort();
    expect(port).toBeGreaterThan(0);
    expect(cdpEndpoint(port)).toBe(`http://127.0.0.1:${port}`);
    // Free: a listener can take it now.
    const listener = net.createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(port, "127.0.0.1", resolve);
    });
    listener.close();
  });
});
