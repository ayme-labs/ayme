import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  agentSocketPath,
  aymeMcpArgs,
  aymeMcpBuiltPrecondition,
  aymeMcpCliPath,
  aymeMcpPortsPrecondition,
  aymeMcpPreconditions,
  aymeMcpServer,
  aymeSkillDirectory,
  aymeSkillSource,
  aymeWebMcpPreconditions,
  browserLaunchArgs,
  initScriptPath,
  initScriptProblem,
  isPageObjectToolName,
  onlyPageObjectToolsFlag,
  pageObjectsEntry,
  pageObjectToolNames,
  otherToolNames,
  proxyScript,
  proxyScriptPath,
  servedPageContextOptions,
  serverPorts,
  webMcpFeatureFlag,
} from "./ayme.ts";
import { agentRoot, evalRoot, labRoot, repoRoot } from "./paths.ts";

describe("the startup lane's skill", () => {
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
      "2026-10-05T10-00-00-000Z-playwright-cli-with-ayme-page-objects-abc123"
    );
    expect(socket.startsWith(os.tmpdir())).toBe(true);
    expect(socket.endsWith("ayme-eval-abc123.sock")).toBe(true);
    expect(socket.length).toBeLessThan(100);
  });

  it("names the built ayme command and the ports a page scans", () => {
    expect(aymeMcpCliPath).toMatch(/\/packages\/mcp\/dist\/cli\.mjs$/);
    expect(serverPorts).toEqual({ first: 9350, last: 9365 });
  });

  it("has every arm with Ayme share one server check and one ports check, so a suite runs each once, and the arms through WebMCP check its package too", () => {
    expect(aymeMcpPreconditions).toEqual([
      aymeMcpBuiltPrecondition,
      aymeMcpPortsPrecondition,
    ]);
    expect(aymeWebMcpPreconditions.map((p) => p.name)).toEqual([
      "Ayme MCP server",
      "Ayme WebMCP package",
      "Ayme MCP ports",
    ]);
    expect(aymeWebMcpPreconditions[0]).toBe(aymeMcpBuiltPrecondition);
    expect(aymeWebMcpPreconditions[2]).toBe(aymeMcpPortsPrecondition);
  });
});

describe("the run's ayme mcp", () => {
  const port = serverPorts.first;

  it("lists the Page Object Tools and page_objects alone, on the port the harness names, for the arms whose agent gets the server", () => {
    expect(onlyPageObjectToolsFlag).toBe("--only-page-object-tools");
    expect(aymeMcpArgs(port, { webmcp: false })).toEqual([
      "mcp",
      "--port",
      "9350",
      "--only-page-object-tools",
    ]);
  });

  it("gets --webmcp instead for the arms that read the page's tools from document.modelContext", () => {
    expect(aymeMcpArgs(port, { webmcp: true })).toEqual([
      "mcp",
      "--port",
      "9350",
      "--webmcp",
    ]);
  });

  it("serves the entry the lab app holds, which the server finds by itself, and writes its init script beside it", () => {
    expect(existsSync(path.join(labRoot, pageObjectsEntry))).toBe(true);
    expect(initScriptPath).toBe(path.join(labRoot, ".ayme/init-script.js"));
  });
});

describe("the agent's working root", () => {
  const outsideIt = (file: string) =>
    path.relative(agentRoot, file).startsWith("..");

  it("is the Formbricks source, inside the lab app's folder", () => {
    expect(agentRoot).toBe(path.join(labRoot, "formbricks"));
  });

  it("holds nothing the lab app keeps of Ayme: the entry the server serves, the Page Objects, their qualification and the init script are all outside it", () => {
    for (const file of [
      pageObjectsEntry,
      ".ayme/pom/SignInPage.ts",
      "tests/page-objects.qualify.ts",
    ]) {
      expect(existsSync(path.join(labRoot, file))).toBe(true);
      expect(outsideIt(path.join(labRoot, file))).toBe(true);
    }
    expect(outsideIt(initScriptPath)).toBe(true);
  });
});

describe("the init script the run's server wrote", () => {
  // As `ayme mcp` writes it, cut to what the check reads: with --webmcp, or with --only-page-object-tools.
  const script = (
    port: number,
    webmcp: boolean,
    onlyPageObjectTools = !webmcp
  ) =>
    `const served = "http://127.0.0.1:${port}/page-objects/";
ayme = createAyme({
  agentConnection: ${onlyPageObjectTools ? '{ tools: "page-objects" }' : "true"},
  inspector: { placement: "external" },
  pageObjects,${webmcp ? "\n  webMCP: { enabled: true }," : ""}
});`;

  it.each([true, false])(
    "passes when it names the run's port, with WebMCP publication %s as the arm wants it and the Page Object Tools alone for the server exactly when the agent gets it",
    (webmcp) => {
      expect(
        initScriptProblem(script(9350, webmcp), { port: 9350, webmcp })
      ).toBeNull();
    }
  );

  it("fails when it names another port, as one an earlier server left would", () => {
    expect(
      initScriptProblem(script(9351, false), { port: 9350, webmcp: false })
    ).toContain("port 9350");
  });

  it.each([true, false])(
    "fails when WebMCP publication is %s and the arm wants the opposite",
    (webmcp) => {
      expect(
        initScriptProblem(script(9350, webmcp), { port: 9350, webmcp: !webmcp })
      ).toContain(webmcp ? "publication on" : "publication off");
    }
  );

  it("fails when the page would hand the agent's server every tool, as a server started without --only-page-object-tools has it", () => {
    expect(
      initScriptProblem(script(9350, false, false), {
        port: 9350,
        webmcp: false,
      })
    ).toContain("every tool of the page");
  });

  it("fails when a server no agent gets was started with --only-page-object-tools too", () => {
    expect(
      initScriptProblem(script(9350, true, true), { port: 9350, webmcp: true })
    ).toContain("the Page Object Tools alone");
  });
});

describe("a browser whose page loads the init script", () => {
  it("lets the page past Formbricks's content security policy and Chrome's local network prompt", () => {
    expect(servedPageContextOptions).toEqual({
      bypassCSP: true,
      permissions: ["local-network-access"],
    });
  });
});

describe("the names an arm with Ayme must not be offered", () => {
  it("are every name but a Page Object Tool and page_objects: snapshot, a Browser Tool, goal, a Peek Tool and the server's own tools", () => {
    expect(
      otherToolNames([
        "ayme_connect",
        "ayme_list_tools",
        "ayme_call",
        "ayme_inspect",
        "snapshot",
        "click",
        "goal",
        "peek.cart",
        "page_objects",
        "SignInPage.logIn",
      ])
    ).toEqual([
      "ayme_connect",
      "ayme_list_tools",
      "ayme_call",
      "ayme_inspect",
      "snapshot",
      "click",
      "goal",
      "peek.cart",
    ]);
  });

  it("are none when the server lists the screen's Page Object Tools and page_objects alone", () => {
    expect(
      otherToolNames([
        "SignInPage.logIn",
        "SignInPage.readError",
        "page_objects",
      ])
    ).toEqual([]);
  });
});

describe("every browser the harness launches", () => {
  it("gets Chrome's WebMCP flag, which supplies document.modelContext, after the arm's own arguments", () => {
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

  it("reads no message: what the agent is offered is the server's own doing", () => {
    expect(proxyScript()).not.toContain("JSON.parse");
    expect(proxyScript()).not.toContain("tools/list");
  });
});
