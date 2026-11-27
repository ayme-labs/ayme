/**
 * The pinned Playwright MCP as the arms run it: the agent's server entry,
 * launching its own browser, and the setup of the arm with ayme. There, as
 * the guide connects the two, Playwright MCP opens the browser on a
 * debugging port its configuration file fixes, and the run's Session
 * attaches to it.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import type {
  ArmContext,
  ArmSetup,
  CommandMcpServer,
  McpServer,
} from "./arms.ts";
import {
  installAymeCommand,
  installAymeSkill,
  startAymeSession,
  type HarnessSession,
} from "./ayme.ts";
import { playwrightMcpRoot } from "./browser.ts";
import { withoutClaudeVariables } from "./claude.ts";

const require = createRequire(import.meta.url);

export function playwrightMcpVersion(): string {
  const manifest = require(path.join(playwrightMcpRoot, "package.json")) as {
    version: string;
  };
  return manifest.version;
}

/**
 * The agent's `playwright` MCP server entry: the server launches the system
 * Chrome itself, headless, on the profile the harness prepared. The tools a
 * page registers through WebMCP stay off, so the agent gets Playwright
 * MCP's own tools only.
 */
export function playwrightMcpServer(
  context: Pick<ArmContext, "profileDir" | "outputDir" | "initPagePath">
): CommandMcpServer {
  return {
    command: process.execPath,
    args: [
      path.join(playwrightMcpRoot, "cli.js"),
      // The system Chrome, Playwright MCP's default; the harness prepares the profile with the same browser.
      "--browser",
      "chrome",
      "--headless",
      "--user-data-dir",
      context.profileDir,
      "--no-webmcp",
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

/** The configuration file the guide gives Playwright MCP: its browser opens on a fixed debugging port. */
export function remoteDebuggingConfig(port: number) {
  return {
    browser: { launchOptions: { args: [`--remote-debugging-port=${port}`] } },
  };
}

/**
 * Playwright MCP as the arm with ayme runs it: a server on `port` that the
 * harness and then the agent connect to over HTTP, so that the harness can
 * make the first tool call, which opens the browser, before the agent
 * starts. Otherwise as in the arm alone: the system Chrome, headless, on the
 * profile the harness prepared, without the page's WebMCP tools. Every
 * client shares the one browser context, so the tab the harness opened is
 * the agent's. No init page: the harness opens the start page itself.
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
    `--config=${options.configPath}`,
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

/** The agent's `playwright` entry when the harness runs the server. */
export function playwrightMcpHttpServer(port: number): McpServer {
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
}

/**
 * The setup of the Playwright MCP arm with ayme. The harness starts
 * Playwright MCP with the configuration file that fixes the browser's
 * debugging port; as a client of its own, it opens the start page with
 * `browser_navigate`, which opens the browser, and attaches the run's
 * Session with `ayme attach`. It stays connected for the run, since the
 * shared browser closes with its last client. Then the `ayme` command and
 * skill, and the agent's `playwright` entry, pointing at the same server.
 */
export async function setUpPlaywrightMcpWithAyme(
  context: ArmContext
): Promise<ArmSetup> {
  const cdpPort = await freeLoopbackPort();
  const serverPort = await freeLoopbackPort();
  const configPath = path.join(context.runDir, "playwright-mcp.config.json");
  const bin = path.join(context.runDir, "bin");
  const skillDir = await installAymeSkill(context.configDir);
  await installAymeCommand(context, bin);
  await mkdir(context.outputDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(remoteDebuggingConfig(cdpPort)));
  const server = await startPlaywrightMcpHttp(
    context,
    playwrightMcpHttpArgs(context, { port: serverPort, configPath })
  );
  const serverEntry = playwrightMcpHttpServer(serverPort);
  const client = new Client({ name: "eval-harness", version: "1.0.0" });
  let session: HarnessSession | undefined;
  const dispose = async () => {
    // The Session first: it only attaches, and the browser is Playwright MCP's to close.
    await session?.end();
    await client.close().catch(() => {});
    await server.stop();
  };
  try {
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${serverPort}/mcp`)
      )
    );
    await callPlaywrightTool(client, "browser_navigate", {
      url: context.start.url,
    });
    session = await startAymeSession(context, {
      attach: cdpEndpoint(cdpPort),
    });
    const evidence = await session.onStartScreen();
    return {
      environment: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` },
      readableDirectories: [context.outputDir, skillDir],
      evidence: {
        ...evidence,
        remoteDebuggingPort: cdpPort,
        playwrightMcpPort: serverPort,
      },
      mcpServers: { playwright: serverEntry },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
