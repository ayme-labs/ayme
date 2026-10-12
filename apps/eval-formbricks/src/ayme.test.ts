import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  agentSocketPath,
  aymeMcpCliPath,
  aymeMcpServer,
  mcpToolTimeoutMs,
  pageObjectToolNames,
  proxyScript,
  proxyScriptPath,
  serverPorts,
  settledStartPageProblem,
} from "./ayme.ts";

describe("the agent's MCP server entry", () => {
  it("is the proxy in the run folder, pointed at the run's socket", () => {
    expect(aymeMcpServer({ runId: "run-abc123", runDir: "/run" })).toEqual({
      command: process.execPath,
      args: ["/run/ayme-mcp-proxy.cjs", agentSocketPath("run-abc123")],
    });
    expect(proxyScriptPath("/run")).toBe("/run/ayme-mcp-proxy.cjs");
  });

  it("keeps the socket path short enough for macOS and apart per run", () => {
    const socket = agentSocketPath(
      "2026-10-05T10-00-00-000Z-ayme-goal-loop-on-abc123"
    );
    expect(socket.startsWith(os.tmpdir())).toBe(true);
    expect(socket.endsWith("ayme-eval-abc123.sock")).toBe(true);
    expect(socket.length).toBeLessThan(100);
  });

  it("names the built ayme command and the ports a page scans", () => {
    expect(aymeMcpCliPath).toMatch(/\/packages\/mcp\/dist\/cli\.mjs$/);
    expect(serverPorts).toEqual({ first: 9350, last: 9365 });
    expect(mcpToolTimeoutMs).toBeGreaterThan(300_000);
  });
});

describe("the Page Object Tools among a page's tools", () => {
  it("are the names with a dot, so neither snapshot, a Browser Tool nor goal counts", () => {
    expect(
      pageObjectToolNames([
        "SignInPage.fillEmail",
        "click",
        "fill_form",
        "goal",
        "snapshot",
        "SurveyEditorPage.questions.setHeadline",
      ])
    ).toEqual([
      "SignInPage.fillEmail",
      "SurveyEditorPage.questions.setHeadline",
    ]);
  });
});

describe("a start page without page objects, looked at again after pairing", () => {
  const settled = {
    tools: ["click", "goal", "snapshot"],
    screenTool: "snapshot",
    goalLoop: true,
    pairedAddress: "ws://127.0.0.1:9350",
    storedAddress: "ws://127.0.0.1:9350",
    pageUrl: "http://localhost:3000/auth/login",
    startUrl: "http://localhost:3000/auth/login",
  };

  it("passes with its screen tool, goal as the Goal Loop says, the pairing and the start URL", () => {
    expect(settledStartPageProblem(settled)).toBeNull();
    expect(
      settledStartPageProblem({
        ...settled,
        tools: ["click", "snapshot"],
        goalLoop: false,
      })
    ).toBeNull();
  });

  it.each([
    [
      "a Page Object Tool",
      { tools: [...settled.tools, "SignInPage.fillEmail"] },
    ],
    ["no tools, as during a reload", { tools: [] }],
    ["goal with the Goal Loop off", { goalLoop: false }],
    ["a lost pairing", { storedAddress: null }],
    [
      "a query the start URL lacks",
      { pageUrl: `${settled.startUrl}?callbackUrl=/setup/intro` },
    ],
    ["another origin", { pageUrl: "http://localhost:3001/auth/login" }],
    ["another path", { pageUrl: "http://localhost:3000/setup/intro" }],
  ])("fails with %s", (_, change) => {
    expect(settledStartPageProblem({ ...settled, ...change })).not.toBeNull();
  });
});

describe("the proxy", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ayme-eval-proxy-"));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it("forwards stdin to the socket and the socket to stdout, and ends with its stdin", async () => {
    const socketPath = path.join(directory, "s.sock");
    const script = path.join(directory, "proxy.cjs");
    writeFileSync(script, proxyScript());
    const received: string[] = [];
    const server = net.createServer((client) => {
      client.on("data", (chunk) => {
        received.push(String(chunk));
        client.write(String(chunk).toUpperCase());
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      const proxy = spawn(process.execPath, [script, socketPath]);
      let output = "";
      proxy.stdout.on("data", (chunk) => (output += String(chunk)));
      proxy.stdin.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
      await expect
        .poll(() => output)
        .toBe('{"JSONRPC":"2.0","ID":1,"METHOD":"PING"}\n');
      expect(received).toEqual(['{"jsonrpc":"2.0","id":1,"method":"ping"}\n']);
      proxy.stdin.end();
      const exitCode = await new Promise<number | null>((resolve) =>
        proxy.once("exit", resolve)
      );
      expect(exitCode).toBe(0);
    } finally {
      server.close();
    }
  });
});
