/**
 * The pinned Playwright MCP as the arms run it: its server entry, on a
 * browser it launches itself or on one the harness launched, and the setups
 * of the arms that add Ayme's Page Object Tools to it. Both drive, through
 * Playwright MCP, the page the run's `ayme mcp` serves the lab app's Page
 * Objects to: the arm with Ayme's server gets their tools from that server,
 * and the arm with WebMCP, whose server is started with `--webmcp` and given
 * to no agent, from Playwright MCP's own WebMCP collection. Either way the
 * harness launches the browser with a remote-debugging port and the
 * server's init script, and Playwright MCP attaches to it over CDP instead
 * of launching its own.
 */
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";

import type { ArmContext, ArmSetup, McpServer } from "./arms.ts";
import { setUpAymePage, setUpWebMcpPage } from "./ayme.ts";
import { playwrightMcpRoot } from "./browser.ts";

const require = createRequire(import.meta.url);

export function playwrightMcpVersion(): string {
  const manifest = require(path.join(playwrightMcpRoot, "package.json")) as {
    version: string;
  };
  return manifest.version;
}

/**
 * The agent's `playwright` MCP server entry. Without `cdpEndpoint`, the server
 * launches the system Chrome itself, headless, on the profile the harness
 * prepared. With it, the server attaches to the browser already running
 * there: Playwright MCP then takes the browser's first context and adopts
 * its open pages as tabs, the first as the current one, so the agent's first
 * look is the start page. The browser, profile and headless switches are
 * accepted beside a CDP endpoint but describe a launch that never happens,
 * so they are left out. The server's init script is not named here either:
 * the harness's own Playwright added it to the browser's context and stays
 * attached, so it runs in every document Playwright MCP navigates the page
 * to. The page's WebMCP tools stay off unless `webmcp`
 * says otherwise: on, Playwright MCP collects the tools the page registered
 * with each snapshot, lists each as a tool of its own named `webmcp_<name>`
 * (a dot in the page's name becomes an underscore) and announces the change
 * of its tool list; its `browser_webmcp_list` and `browser_webmcp_call` are
 * the CLI's alone. The init-page script, which runs on adopted tabs too,
 * only acts on a blank page, so it opens the start page in a tab the agent
 * adds, as in the launched case.
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
      // Unless the arm wants the page's tools through WebMCP, the agent gets Playwright MCP's own tools only.
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

/** Where Playwright MCP attaches to the browser the harness launched. */
export function cdpEndpoint(port: number) {
  return `http://127.0.0.1:${port}`;
}

/**
 * The setup of the arm with both servers: the run's Ayme server, started
 * with `--only-page-object-tools`, and the page paired with it
 * (`setUpAymePage`), the lab app's Page Objects served and the browser
 * listening on a remote-debugging port; then Playwright MCP's entry,
 * attached to that browser, which the run adds to the agent's MCP servers.
 * No skill, no readable folder and no environment beyond the Playwright MCP
 * arm's.
 */
export async function setUpPlaywrightMcpWithAymePageObjects(
  context: ArmContext
): Promise<ArmSetup> {
  const port = await freeLoopbackPort();
  const { evidence, dispose } = await setUpAymePage(context, {
    browserArgs: [`--remote-debugging-port=${port}`],
  });
  return {
    environment: {},
    readableDirectories: [],
    evidence: { ...evidence, remoteDebuggingPort: port },
    mcpServers: {
      playwright: playwrightMcpServer(context, {
        cdpEndpoint: cdpEndpoint(port),
      }),
    },
    dispose,
  };
}

/**
 * The setup of the arm with the page's tools through WebMCP: the page with
 * the lab app's Page Objects served with
 * `--webmcp`, on a browser with the WebMCP flag and a remote-debugging
 * port, and the run's Ayme server given to no agent; then Playwright MCP's
 * entry, attached to that browser with its WebMCP collection on, which the
 * run adds to the agent's MCP servers. No skill, no readable folder and no
 * environment beyond the Playwright MCP arm's.
 */
export async function setUpPlaywrightMcpWithAymeWebMcp(
  context: ArmContext
): Promise<ArmSetup> {
  const port = await freeLoopbackPort();
  const { evidence, dispose } = await setUpWebMcpPage(context, {
    browserArgs: [`--remote-debugging-port=${port}`],
  });
  return {
    environment: {},
    readableDirectories: [],
    evidence: { ...evidence, remoteDebuggingPort: port },
    mcpServers: {
      playwright: playwrightMcpServer(context, {
        cdpEndpoint: cdpEndpoint(port),
        webmcp: true,
      }),
    },
    dispose,
  };
}
