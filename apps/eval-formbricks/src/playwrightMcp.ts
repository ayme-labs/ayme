/**
 * The pinned Playwright MCP as the arms run it: its server entry, on a
 * browser it launches itself or on one the harness launched, and the setup
 * of the arms that add Ayme's Page Object Tools to it. Those drive, through
 * Playwright MCP, the page the run's `ayme mcp` serves the lab app's Page
 * Objects to: the harness launches the browser with a remote-debugging port
 * and the server's init script, and Playwright MCP attaches to it over CDP
 * instead of launching its own.
 */
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";

import type { ArmContext, ArmSetup, McpServer } from "./arms.ts";
import { installAymeSkill, setUpAymePage, type AymeChannel } from "./ayme.ts";
import { playwrightMcpRoot } from "./browser.ts";

const require = createRequire(import.meta.url);

export function playwrightMcpVersion(): string {
  const manifest = require(path.join(playwrightMcpRoot, "package.json")) as {
    version: string;
  };
  return manifest.version;
}

/**
 * The agent's `playwright` MCP server entry. Without `cdpEndpoint`, the
 * server launches the system Chrome itself, headless, on the profile the
 * harness prepared. With it, the server attaches to the browser already
 * running there and adopts its open pages, the start page first; the
 * browser, profile and headless switches describe a launch that never
 * happens, so they are left out, and so is the init script, which the
 * harness's own Playwright added to the browser's context. The page's WebMCP
 * tools stay off unless `webmcp`: on, Playwright MCP collects the tools the
 * page registered with each snapshot and lists each as `webmcp_<name>`.
 */
export function playwrightMcpServer(
  context: Pick<ArmContext, "profileDir" | "outputDir" | "initPagePath">,
  options: { cdpEndpoint?: string; webmcp?: boolean } = {}
): McpServer {
  const browser =
    options.cdpEndpoint === undefined
      ? [
          // The system Chrome, Playwright MCP's default; the harness prepares the profile with the same browser.
          "--browser",
          "chrome",
          "--headless",
          "--user-data-dir",
          context.profileDir,
        ]
      : ["--cdp-endpoint", options.cdpEndpoint];
  return {
    command: process.execPath,
    args: [
      path.join(playwrightMcpRoot, "cli.js"),
      ...browser,
      ...(options.webmcp ? [] : ["--no-webmcp"]),
      "--output-dir",
      context.outputDir,
      "--init-page",
      context.initPagePath,
    ],
  };
}

/** A port nothing listens on, on the loopback interface, as of now. */
export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** Where a browser automation attaches to the browser the harness launched. */
export function cdpEndpoint(port: number) {
  return `http://127.0.0.1:${port}`;
}

/**
 * The setup of the Playwright MCP arms with Ayme: the page paired with the
 * run's `ayme mcp`, started as the skill reference says for the channel, on
 * a browser with a remote-debugging port; the `ayme` skill in the run's
 * configuration folder; then Playwright MCP's entry, attached to that
 * browser with its WebMCP collection on for the `webmcp` channel alone.
 */
export async function setUpPlaywrightMcpWithAyme(
  context: ArmContext,
  channel: AymeChannel
): Promise<ArmSetup> {
  const skillDir = await installAymeSkill(context.configDir);
  const port = await freeLoopbackPort();
  const { evidence, dispose } = await setUpAymePage(context, {
    channel,
    browserArgs: [`--remote-debugging-port=${port}`],
  });
  return {
    environment: {},
    readableDirectories: [skillDir],
    evidence: { ...evidence, remoteDebuggingPort: port },
    mcpServers: {
      playwright: playwrightMcpServer(context, {
        cdpEndpoint: cdpEndpoint(port),
        webmcp: channel === "webmcp",
      }),
    },
    dispose,
  };
}
