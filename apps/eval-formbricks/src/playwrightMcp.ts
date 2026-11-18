/**
 * The pinned Playwright MCP as the arms run it: its server entry, on a
 * browser it launches itself or on one the harness launched, and the setup
 * of the arms that add Ayme's Page Object Tools to it. Those drive, through
 * Playwright MCP, the page the run's `ayme mcp` serves the lab app's Page
 * Objects to: the harness launches the browser with a remote-debugging port
 * and the server's init script, and Playwright MCP attaches to it over CDP
 * instead of launching its own.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { ArmContext, ArmSetup, HttpMcpServer, McpServer } from "./arms.ts";
import { installAymeSkill, setUpAymePage, type AymeChannel } from "./ayme.ts";
import {
  attachAymeCli,
  aymeCliEnvironment,
  installAymeCli,
  installAymeCliSkill,
  markGlobal,
} from "./aymeCli.ts";
import { playwrightMcpRoot } from "./browser.ts";
import { withoutClaudeVariables } from "./claude.ts";
import { remoteDebuggingConfig, shimDirectory } from "./playwrightCli.ts";

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

export function playwrightMcpConfigPath(runDir: string) {
  return path.join(runDir, "playwright-mcp.config.json");
}

/**
 * Spike: Playwright MCP as the arm with the `ayme` command runs it, a server
 * on `port` that the harness and then the agent connect to over HTTP. It
 * launches the system Chrome itself, headless, on the profile the harness
 * prepared, as in the arm alone, with a configuration file that gives the
 * browser a remote-debugging port. Every client shares that browser, so the
 * tab the harness opened and marked is the agent's. No init page: it would
 * run again on the open tab when the agent connects.
 */
export function playwrightMcpHttpArgs(
  context: Pick<ArmContext, "profileDir" | "outputDir">,
  options: { port: number; configPath: string }
): string[] {
  return [
    path.join(playwrightMcpRoot, "cli.js"),
    "--browser",
    "chrome",
    "--headless",
    "--user-data-dir",
    context.profileDir,
    "--no-webmcp",
    "--output-dir",
    context.outputDir,
    "--config",
    options.configPath,
    "--host",
    "127.0.0.1",
    "--port",
    String(options.port),
    // The server accepts only a `localhost` Host header unless told otherwise.
    "--allowed-hosts",
    `127.0.0.1:${options.port}`,
    "--shared-browser-context",
  ];
}

/** The agent's `playwright` MCP server entry when the harness runs the server. */
export function playwrightMcpHttpServer(port: number): HttpMcpServer {
  return { type: "http", url: `http://127.0.0.1:${port}/mcp` };
}

/** Starts the server in the agent's working root and resolves once it listens; stops it when it does not. */
async function startPlaywrightMcpHttp(
  context: ArmContext,
  args: string[]
): Promise<{ stop: () => Promise<void> }> {
  await mkdir(context.runDir, { recursive: true });
  const logStream = createWriteStream(
    path.join(context.runDir, "playwright-mcp.log")
  );
  const child = spawn(process.execPath, args, {
    cwd: context.cwd,
    // Scrubbed, so the server and its browser carry none of the launcher's Claude Code variables or token.
    env: withoutClaudeVariables(process.env),
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group, so stopping it stops the browser it launched too.
    detached: true,
  });
  let output = "";
  const listening = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Playwright MCP did not listen within 30 s. Its output:\n${output}`
          )
        ),
      30_000
    );
    const read = (chunk: Buffer) => {
      logStream.write(chunk);
      output += String(chunk);
      if (output.includes("Listening on ")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout!.on("data", read);
    child.stderr!.on("data", read);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`Playwright MCP exited with ${code}. Its output:\n${output}`)
      );
    });
  });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      const signal = (name: NodeJS.Signals) => {
        try {
          process.kill(-child.pid!, name);
        } catch {
          // Already gone.
        }
      };
      signal("SIGTERM");
      const timer = setTimeout(() => signal("SIGKILL"), 10_000);
      await exited;
      clearTimeout(timer);
    }
    logStream.end();
  };
  try {
    await listening;
  } catch (error) {
    await stop();
    throw error;
  }
  return { stop };
}

/** Calls one of Playwright MCP's tools as the harness; throws when it answers with an error. */
async function callPlaywrightTool(
  client: Client,
  name: string,
  args: Record<string, unknown>
) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const text = (result.content as { type: string; text?: string }[])
      .map((part) => part.text ?? "")
      .join("\n");
    throw new Error(`Playwright MCP's ${name} failed: ${text}`);
  }
  return result;
}

/**
 * Spike: the setup of the Playwright MCP arm with Ayme through the `ayme`
 * command. The harness starts Playwright MCP, which launches its own browser
 * on Formbricks as it is, as in the arm alone, made reachable over CDP by a
 * configuration file. As a client of its own, the harness opens the start
 * page with `browser_navigate`, marks the tab with `browser_evaluate`, and
 * attaches Ayme's background process to that browser; it stays connected
 * for the run, since the shared browser closes with its last client. Then
 * the `ayme` command and its skill, and the agent's `playwright` entry,
 * pointing at the same server. Nothing is loaded into the page.
 */
export async function setUpPlaywrightMcpWithAymeCli(
  context: ArmContext
): Promise<ArmSetup> {
  const cdpPort = await freeLoopbackPort();
  const serverPort = await freeLoopbackPort();
  const configPath = playwrightMcpConfigPath(context.runDir);
  const bin = shimDirectory(context.runDir);
  const environment = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    ...aymeCliEnvironment(context),
  };
  const aymeSkillDir = await installAymeCliSkill(context.configDir);
  await installAymeCli(bin);
  await mkdir(context.outputDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(remoteDebuggingConfig(cdpPort)));
  const server = await startPlaywrightMcpHttp(
    context,
    playwrightMcpHttpArgs(context, { port: serverPort, configPath })
  );
  const serverEntry = playwrightMcpHttpServer(serverPort);
  const client = new Client({ name: "eval-harness", version: "1.0.0" });
  let ayme: Awaited<ReturnType<typeof attachAymeCli>> | undefined;
  const dispose = async () => {
    // Ayme's process first: it only attaches, and the browser is Playwright MCP's to close.
    await ayme?.dispose();
    await client.close().catch(() => {});
    await server.stop();
  };
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(serverEntry.url))
    );
    await callPlaywrightTool(client, "browser_navigate", {
      url: context.start.url,
    });
    ayme = await attachAymeCli(context, environment, {
      shimDirectory: bin,
      endpoint: cdpEndpoint(cdpPort),
      setMark: (token) =>
        callPlaywrightTool(client, "browser_evaluate", {
          function: `() => (window.${markGlobal} = ${JSON.stringify(token)})`,
        }),
    });
  } catch (error) {
    await dispose();
    throw error;
  }
  return {
    environment,
    readableDirectories: [context.outputDir, aymeSkillDir],
    evidence: {
      ...ayme.evidence,
      remoteDebuggingPort: cdpPort,
      playwrightMcpPort: serverPort,
    },
    mcpServers: { playwright: serverEntry },
    dispose,
  };
}
