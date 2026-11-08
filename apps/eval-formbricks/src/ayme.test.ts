import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  agentSocketPath,
  aymeMcpCliPath,
  aymeMcpPortsPrecondition,
  aymeMcpPreconditions,
  aymeMcpServer,
  aymeSkillDirectory,
  aymeSkillSource,
  aymeWebMcpPreconditions,
  browserLaunchArgs,
  isPageObjectToolName,
  mcpToolTimeoutMs,
  pageObjectToolNames,
  proxyScript,
  proxyScriptPath,
  serverPorts,
  settledStartPageProblem,
  webMcpFeatureFlag,
} from "./ayme.ts";
import { evalRoot, repoRoot } from "./paths.ts";

describe("the Ayme arms' skill", () => {
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

  it("has the arms with and without a server share one ports check, so a suite runs it once", () => {
    expect(aymeMcpPreconditions.map((p) => p.name)).toEqual([
      "Ayme MCP server",
      "Ayme MCP ports",
    ]);
    expect(aymeMcpPreconditions[1]).toBe(aymeMcpPortsPrecondition);
    expect(aymeWebMcpPreconditions).toEqual([aymeMcpPortsPrecondition]);
  });
});

describe("every browser the harness launches", () => {
  it("gets Chrome's WebMCP flag, which supplies document.modelContext without the app's polyfill, after the arm's own arguments", () => {
    expect(webMcpFeatureFlag).toBe("--enable-features=WebMCP");
    expect(browserLaunchArgs()).toEqual(["--enable-features=WebMCP"]);
    expect(browserLaunchArgs(["--remote-debugging-port=9222"])).toEqual([
      "--remote-debugging-port=9222",
      "--enable-features=WebMCP",
    ]);
  });

  it("joins an arm's extra Chrome features into that one switch, since Chrome reads one --enable-features", () => {
    expect(
      browserLaunchArgs(
        ["--remote-debugging-port=9222"],
        ["WebMCPTesting", "DevToolsWebMCPSupport"]
      )
    ).toEqual([
      "--remote-debugging-port=9222",
      "--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport",
    ]);
  });
});

describe("the Page Object Tools among a page's tools", () => {
  it("are the names shaped <class>.<action>, so neither snapshot, a Browser Tool, goal nor a server tool counts", () => {
    expect(
      pageObjectToolNames([
        "SignInPage.logIn",
        "click",
        "fill_form",
        "goal",
        "snapshot",
        "ayme_list_tools",
        "Question.setHeadline",
      ])
    ).toEqual(["SignInPage.logIn", "Question.setHeadline"]);
  });

  it.each(["peek.cart", "peek.node.orders", "a.b.c", ".fill", "Page.", "Page"])(
    "leave out %s",
    (name) => {
      expect(isPageObjectToolName(name)).toBe(false);
    }
  );

  it("take any class and action identifiers", () => {
    expect(isPageObjectToolName("survey_editor.save_and_close")).toBe(true);
    expect(isPageObjectToolName("$Page._go")).toBe(true);
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
    ["a Page Object Tool", { tools: [...settled.tools, "SignInPage.logIn"] }],
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

/**
 * The proxy offering the Page Object Tools alone, against a stand-in server
 * on the socket that answers tools/list with every kind of tool, echoes any
 * other request as its result, and sends a list_changed notification when
 * asked to.
 */
describe("the proxy offering the Page Object Tools alone", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ayme-eval-filter-"));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  const listed = [
    { name: "ayme_connect", inputSchema: { type: "object" } },
    { name: "ayme_list_tools", inputSchema: { type: "object" } },
    { name: "ayme_call", inputSchema: { type: "object" } },
    { name: "ayme_inspect", inputSchema: { type: "object" } },
    { name: "snapshot", inputSchema: { type: "object" } },
    { name: "click", inputSchema: { type: "object" } },
    { name: "fill_form", inputSchema: { type: "object" } },
    { name: "navigate", inputSchema: { type: "object" } },
    { name: "goal", inputSchema: { type: "object" } },
    { name: "peek.cart", inputSchema: { type: "object" } },
    {
      name: "SurveyEditorPage.setSurveyName",
      description: "Sets the name.",
      inputSchema: { type: "object", properties: { name: { type: "string" } } },
    },
    { name: "Question.setHeadline", inputSchema: { type: "object" } },
  ];
  const listChanged = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/tools/list_changed",
  });

  async function startProxy(name: string) {
    const socketPath = path.join(directory, `${name}.sock`);
    const script = path.join(directory, `${name}.cjs`);
    writeFileSync(script, proxyScript({ pageObjectToolsOnly: true }));
    const received: unknown[] = [];
    let client: net.Socket | undefined;
    const server = net.createServer((socket) => {
      client = socket;
      let rest = "";
      socket.on("data", (chunk) => {
        rest += String(chunk);
        const lines = rest.split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) {
          const message = JSON.parse(line) as {
            id?: number;
            method: string;
            params?: unknown;
          };
          received.push(message);
          if (message.method === "tools/list")
            socket.write(
              `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: listed, nextCursor: "n" } })}\n`
            );
          else if (message.id !== undefined)
            socket.write(
              `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { echoed: message.params } })}\n`
            );
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    const proxy = spawn(process.execPath, [script, socketPath]);
    let output = "";
    proxy.stdout.on("data", (chunk) => (output += String(chunk)));
    const lines = () =>
      output
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    return {
      proxy,
      received,
      lines,
      notify: () => client!.write(`${listChanged}\n`),
      close: async () => {
        proxy.stdin.end();
        await new Promise((resolve) => proxy.once("exit", resolve));
        server.close();
      },
    };
  }

  it("keeps the Page Object Tools of a tools/list answer and drops every other tool, leaving the rest of the answer", async () => {
    const { proxy, received, lines, close } = await startProxy("list");
    try {
      proxy.stdin.write(
        '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n'
      );
      await expect.poll(() => lines().length).toBe(1);
      expect(lines()[0]).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: {
          tools: [listed[10], listed[11]],
          nextCursor: "n",
        },
      });
      expect(received).toEqual([
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      ]);
    } finally {
      await close();
    }
  });

  it("forwards a call of a Page Object Tool and its result", async () => {
    const { proxy, received, lines, close } = await startProxy("call");
    try {
      proxy.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: "c1", method: "tools/call", params: { name: "SurveyEditorPage.setSurveyName", arguments: { name: "x" } } })}\n`
      );
      await expect.poll(() => lines().length).toBe(1);
      expect(lines()[0]).toEqual({
        jsonrpc: "2.0",
        id: "c1",
        result: {
          echoed: {
            name: "SurveyEditorPage.setSurveyName",
            arguments: { name: "x" },
          },
        },
      });
      expect(received).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it.each(["click", "snapshot", "ayme_call", "goal", "peek.cart"])(
    "answers a call of %s with a JSON-RPC error and never forwards it",
    async (name) => {
      const { proxy, received, lines, close } = await startProxy(
        `refuse-${name}`
      );
      try {
        proxy.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: {} } })}\n`
        );
        await expect.poll(() => lines().length).toBe(1);
        expect(lines()[0]).toEqual({
          jsonrpc: "2.0",
          id: 7,
          error: { code: -32602, message: `Unknown tool "${name}".` },
        });
        // A later request still reaches the server, after nothing of the refused one did.
        proxy.stdin.write('{"jsonrpc":"2.0","id":8,"method":"ping"}\n');
        await expect.poll(() => lines().length).toBe(2);
        expect(received).toEqual([{ jsonrpc: "2.0", id: 8, method: "ping" }]);
      } finally {
        await close();
      }
    }
  );

  it("passes notifications and other messages through unchanged, both ways", async () => {
    const { proxy, received, lines, notify, close } = await startProxy("pass");
    try {
      proxy.stdin.write(
        '{"jsonrpc":"2.0","method":"notifications/initialized"}\n'
      );
      proxy.stdin.write(
        '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"capabilities":{}}}\n'
      );
      await expect.poll(() => lines().length).toBe(1);
      notify();
      await expect.poll(() => lines().length).toBe(2);
      expect(received).toEqual([
        { jsonrpc: "2.0", method: "notifications/initialized" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "initialize",
          params: { capabilities: {} },
        },
      ]);
      expect(lines()[1]).toEqual(JSON.parse(listChanged));
    } finally {
      await close();
    }
  });

  it("reads messages whole however they are chunked", async () => {
    const { proxy, lines, close } = await startProxy("chunks");
    try {
      const list = '{"jsonrpc":"2.0","id":3,"method":"tools/list"}\n';
      const call =
        '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"click","arguments":{}}}\n';
      const text = list + call;
      for (let at = 0; at < text.length; at += 7) {
        proxy.stdin.write(text.slice(at, at + 7));
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      await expect.poll(() => lines().length).toBe(2);
      const byId = Object.fromEntries(lines().map((line) => [line.id, line]));
      expect(
        (byId[3] as { result: { tools: { name: string }[] } }).result.tools.map(
          (tool) => tool.name
        )
      ).toEqual(["SurveyEditorPage.setSurveyName", "Question.setHeadline"]);
      expect(byId[4]).toHaveProperty("error");
    } finally {
      await close();
    }
  });

  it("is written with the filter off for the Ayme arms", () => {
    expect(proxyScript()).toContain("const pageObjectToolsOnly = false;");
    expect(proxyScript({ pageObjectToolsOnly: true })).toContain(
      "const pageObjectToolsOnly = true;"
    );
  });
});
