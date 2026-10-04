/**
 * Everything the Ayme arms set up before the measured window: the WebMCP local
 * relay the page connects to, and a headless browser holding the signed-in
 * survey editor with the Goal Loop switch set for the arm. Claude Code starts
 * the agent's own relay instance only when the agent starts, so the harness
 * owns the relay the page connects to, and the agent's instance joins it in
 * the relay's client mode. The page is then connected, with its tools listed,
 * before the agent's first turn.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { RelayBridgeServer } from "@mcp-b/webmcp-local-relay";

import type { ArmContext, ArmSetup, McpServer } from "./arms.ts";
import { playwright, viewport } from "./browser.ts";

export const relayPackageName = "@mcp-b/webmcp-local-relay";
// The package exports only its entry (dist/index.mjs), so its folder is found from there.
const relayRoot = path.resolve(
  path.dirname(createRequire(import.meta.url).resolve(relayPackageName)),
  ".."
);
export const relayCliPath = path.join(relayRoot, "dist/cli.mjs");

export function relayVersion(): string {
  const manifest = JSON.parse(
    readFileSync(path.join(relayRoot, "package.json"), "utf8")
  ) as { version: string };
  return manifest.version;
}

/** The MCP server's name in the agent's configuration; its tools are `mcp__webmcp-local-relay__<tool>`. */
export const relayServerName = "webmcp-local-relay";

/** Opens a URL in the machine's default browser, outside the run. Denied. */
export const relayOpenPageTool = `mcp__${relayServerName}__webmcp_open_page`;

/**
 * The lab app's Goal Loop switch: with this cookie set before the page loads,
 * the page publishes `goal`. Without it the Goal Loop is off.
 */
export const goalLoopCookie = { name: "ayme-lab-goal-loop", value: "on" };

/**
 * How long one relayed tool call may run. The `goal` tool runs the whole Goal
 * Loop inside one call, far beyond the relay's 65 s default; the lab app's
 * embed allows the page a little less, so the page's own timeout answers first.
 */
export const relayInvokeTimeoutMs = 305_000;

/** The Page Object Tool the editor publishes: proof that the connected page is the editor with Ayme's tools. */
const editorTool = "SurveyEditorPage_setSurveyName";

/** What the setup established before the measured window, recorded in the result. */
export type RelayEvidence = {
  relay: { mode: string; port: number; version: string };
  page: { url: string };
  /** The relayed tool names, as the agent sees them without the server prefix. */
  tools: string[];
  goalToolPublished: boolean;
};

/** The agent's relay instance; it finds the harness's relay on the same ports and joins it. */
export function relayMcpServer(origin: string): McpServer {
  return {
    command: process.execPath,
    args: [
      relayCliPath,
      "--widget-origin",
      origin,
      "--invoke-timeout",
      String(relayInvokeTimeoutMs),
    ],
  };
}

const pathnameOf = (url: string) => new URL(url).pathname;

/** Waits until the page at `startUrl` is connected with the editor's tools, and `goal` matches the arm. */
async function waitForRelayedPage(
  bridge: RelayBridgeServer,
  startUrl: string,
  goalLoop: boolean,
  timeoutMs: number
): Promise<{ url: string; tools: string[] }> {
  const deadline = Date.now() + timeoutMs;
  let seen: { url: string; tools: string[] } | null = null;
  while (Date.now() < deadline) {
    const source = bridge.registry
      .listSources()
      .find(
        (candidate) =>
          candidate.url !== undefined &&
          pathnameOf(candidate.url) === pathnameOf(startUrl)
      );
    if (source?.url !== undefined) {
      const tools = bridge.registry
        .listTools()
        .filter((tool) =>
          tool.sources.some((owner) => owner.sourceId === source.sourceId)
        )
        .map((tool) => tool.name)
        .sort();
      seen = { url: source.url, tools };
      const complete =
        tools.includes(editorTool) && (!goalLoop || tools.includes("goal"));
      if (complete) return seen;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    seen === null
      ? `No page connected to the relay within ${timeoutMs / 1000} s. The lab app must run in lab mode (pnpm lab:dev) for the relay embed to load.`
      : `The page ${seen.url} connected to the relay but did not publish ${goalLoop ? `${editorTool} and goal` : editorTool} within ${timeoutMs / 1000} s; it published ${seen.tools.join(", ") || "nothing"}.`
  );
}

/**
 * Starts the relay the page connects to, opens the signed-in editor with the
 * Goal Loop switch set for the arm, and waits for the page's tools to arrive.
 */
export async function setUpAymeRelay(
  context: ArmContext,
  options: { goalLoop: boolean }
): Promise<ArmSetup> {
  const origin = new URL(context.startUrl).origin;
  const bridge = new RelayBridgeServer({
    allowedOrigins: [origin],
    // The relay caches its port in the home folder by default; this run's stays in its folder.
    persistPath: path.join(context.runDir, "relay-port.json"),
    invokeTimeoutMs: relayInvokeTimeoutMs,
    label: `ayme-eval ${context.runId}`,
  });
  await bridge.start();
  if (bridge.mode !== "server") {
    await bridge.stop();
    throw new Error(
      `Another WebMCP relay owns port ${bridge.port}, so the page would connect to it instead of this run's relay. Stop it and run again.`
    );
  }
  context.log(`Relay listening on port ${bridge.port}.`);

  const browser = await playwright().chromium.launchPersistentContext(
    context.profileDir,
    { channel: "chrome", headless: true, viewport }
  );
  const dispose = async () => {
    for (const close of [() => browser.close(), () => bridge.stop()]) {
      try {
        await close();
      } catch (error) {
        context.log(
          `Closing the relay setup failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  };

  try {
    if (options.goalLoop)
      await browser.addCookies([{ ...goalLoopCookie, url: origin }]);
    const page = browser.pages()[0] ?? (await browser.newPage());
    await page.goto(context.startUrl);
    const connected = await waitForRelayedPage(
      bridge,
      context.startUrl,
      options.goalLoop,
      90_000
    );
    const goalToolPublished = connected.tools.includes("goal");
    if (goalToolPublished !== options.goalLoop)
      throw new Error(
        `The page publishes goal although the Goal Loop should be off for ${context.runId}.`
      );
    context.log(
      `The editor is connected to the relay with ${connected.tools.length} tools; goal ${goalToolPublished ? "is" : "is not"} published.`
    );
    const evidence: RelayEvidence = {
      relay: { mode: bridge.mode, port: bridge.port, version: relayVersion() },
      page: { url: connected.url },
      tools: connected.tools,
      goalToolPublished,
    };
    return {
      // Claude Code's own per-call limit must outlast a goal call, so it is set above the relay's.
      environment: { MCP_TOOL_TIMEOUT: String(relayInvokeTimeoutMs + 15_000) },
      readableDirectories: [],
      evidence,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
