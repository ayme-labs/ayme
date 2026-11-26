import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  agentSocketPath,
  aymeMcpCliPath,
  aymeMcpServer,
  aymeSkillDirectory,
  aymeMcpArgs,
  aymeSkillSource,
  aymeStartArgs,
  initScriptProblem,
  isPageObjectToolName,
  proxyScript,
  proxyScriptPath,
  serverPorts,
  unexpectedToolNames,
} from "./ayme.ts";
import { evalRoot, repoRoot } from "./paths.ts";

describe("the ayme arms' skill", () => {
  it("is the one the repository ships, under skills/", () => {
    const skills = path.join(repoRoot, "skills");
    expect(aymeSkillSource.startsWith(`${skills}${path.sep}`)).toBe(true);
    expect(existsSync(path.join(aymeSkillSource, "SKILL.md"))).toBe(true);
    expect(
      existsSync(path.join(aymeSkillSource, "references/page-tools.md"))
    ).toBe(true);
  });

  it("has no copy in this package", () => {
    expect(existsSync(path.join(evalRoot, "skills"))).toBe(false);
  });

  it("is copied into the run's configuration folder, where Claude Code loads user skills from", () => {
    expect(aymeSkillDirectory("/run/claude-config")).toBe(
      "/run/claude-config/skills/ayme"
    );
  });
});

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
      "2026-10-05T10-00-00-000Z-playwright-mcp-with-ayme-abc123"
    );
    expect(socket.startsWith(os.tmpdir())).toBe(true);
    expect(socket.endsWith("ayme-eval-abc123.sock")).toBe(true);
    expect(socket.length).toBeLessThan(100);
  });

  it("names the built ayme command and the ports a page scans", () => {
    expect(aymeMcpCliPath).toMatch(/\/packages\/mcp\/dist\/cli\.mjs$/);
    expect(serverPorts).toEqual({ first: 9350, last: 9365 });
  });
});

describe("the ayme mcp command", () => {
  it("is `mcp`, on the run's port", () => {
    expect(aymeStartArgs).toEqual(["mcp"]);
    expect(aymeMcpArgs(9350)).toEqual(["mcp", "--port", "9350"]);
  });
});

describe("the Page Object Tools among a page's tools", () => {
  it("are the names with one dot, outside the peek family", () => {
    expect(
      [
        "SignInPage.logIn",
        "Question.setHeadline",
        "peek.store",
        "page_objects",
        "snapshot",
        "goal",
        "click",
      ].filter(isPageObjectToolName)
    ).toEqual(["SignInPage.logIn", "Question.setHeadline"]);
  });
});

describe("the tools ayme mcp must not list", () => {
  const listed = [
    "SignInPage.logIn",
    "page_objects",
    "ayme_connect",
    "ayme_inspect",
    "ayme_list_tools",
    "ayme_call",
    "snapshot",
    "goal",
    "click",
  ];

  it("are all but Page Object Tools, page_objects and its own tools", () => {
    expect(unexpectedToolNames(listed)).toEqual(["snapshot", "goal", "click"]);
  });
});

describe("the init script the run's server writes", () => {
  const script = (port: number) => `const base = "http://127.0.0.1:${port}/";`;

  it("passes when it names the run's port", () => {
    expect(initScriptProblem(script(9350), 9350)).toBeNull();
  });

  it("fails when it names another port", () => {
    expect(initScriptProblem(script(9351), 9350)).not.toBeNull();
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
